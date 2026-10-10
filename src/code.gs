/**
 * ====================================================================================
 * ENTERPRISE REIMBURSEMENT APPROVAL SYSTEM (GAS)
 * ====================================================================================
 */

const SS                    = SpreadsheetApp.getActiveSpreadsheet();
const SHEET_DATA            = "Working Sheet";
const SHEET_RESPONSES       = "Form Responses 1";
const SHEET_CONFIG          = "Config";
const SHEET_CONFIG_WORKING  = "Config Working Sheet";

// GANTI DENGAN FOLDER ID DRIVE UNTUK MENYIMPAN LAMPIRAN
const FOLDER_SCREENSHOT_ID  = "YOUR_DRIVE_FOLDER_ID_HERE"; 

// GANTI DENGAN URL WEB APP DEPLOYMENT ANDA
const WEB_APP_URL_RAW       = "YOUR_WEB_APP_URL_RAW_HERE";
const GOOGLE_LOGIN_BRIDGE   = "https://accounts.google.com/AccountChooser?continue=";
const WEB_APP_URL           = GOOGLE_LOGIN_BRIDGE + encodeURIComponent(WEB_APP_URL_RAW);

let _configCache = null;

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function getConfig(key) {
  if (!_configCache) {
    _configCache = {};
    const configSheet = SS.getSheetByName(SHEET_CONFIG);
    if (!configSheet) return null; 
    const data = configSheet.getDataRange().getValues();
    for (let i = 0; i < data.length; i++) {
      const k = data[i][0] ? data[i][0].toString().trim() : "";
      if (!k) continue;
      _configCache[k] = (data[i][1] !== "" && data[i][1] !== null && data[i][1] !== undefined)
        ? data[i][1] : (data[i][2] || null);
    }
  }
  return Object.prototype.hasOwnProperty.call(_configCache, key) ? _configCache[key] : null;
}

function getRowData(row, sheet) {
  const lastCol   = sheet.getLastColumn();
  const headers   = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values    = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  const headerMap = {};
  
  headers.forEach((h, i) => { headerMap[h.toString().trim().toLowerCase()] = i; });

  return {
    headers, values,
    get: function(headerName) {
      if (!headerName) return null;
      const idx = headerMap[headerName.toString().trim().toLowerCase()];
      return (idx !== undefined) ? values[idx] : null;
    },
    colIdx: function(headerName) {
      if (!headerName) return -1;
      const idx = headerMap[headerName.toString().trim().toLowerCase()];
      return (idx !== undefined) ? idx : -1;
    }
  };
}

function getValueByHeader(row, headerName, headers, sheet) {
  if (!headerName) return null;
  const colIndex = headers.map(h => h.toString().trim().toLowerCase()).indexOf(headerName.toString().trim().toLowerCase());
  if (colIndex === -1) return null;
  return sheet.getRange(row, colIndex + 1).getValue();
}

function formatRibuan(val) {
  if (val === "" || val === null || val === undefined) return "-";
  const numericVal = Number(val.toString().replace(/[^0-9.-]+/g, ""));
  if (isNaN(numericVal)) return val.toString();
  return new Intl.NumberFormat('en-US').format(numericVal);
}

function columnToLetter(column) {
  let temp, letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

// ─────────────────────────────────────────────────────────────────────────────
// TRIGGERS & RUNNERS
// ─────────────────────────────────────────────────────────────────────────────

function onFormSubmit(e) {
  if (e && e.range) moveResponseToWorkingSheet(e.range.getRow());
}

function runManualForAllPending() {
  const respSheet   = SS.getSheetByName(SHEET_RESPONSES);
  const respHeaders = respSheet.getRange(1, 1, 1, respSheet.getLastColumn()).getValues()[0].map(h => h.toString().trim().toLowerCase());
  const lastRowResp = respSheet.getLastRow();
  const timestampIdx = respHeaders.indexOf("timestamp");
  const statusToWorkingIdx = respHeaders.indexOf("status to working sheet");

  if (timestampIdx !== -1 && statusToWorkingIdx !== -1) {
    for (let rRow = 2; rRow <= lastRowResp; rRow++) {
      if (!respSheet.getRange(rRow, timestampIdx + 1).getValue()) break;
      if (respSheet.getRange(rRow, statusToWorkingIdx + 1).getValue() !== "DONE") {
        moveResponseToWorkingSheet(rRow, false); 
      }
    }
  }

  SpreadsheetApp.flush(); 

  const workSheet   = SS.getSheetByName(SHEET_DATA);
  const workHeaders = workSheet.getRange(1, 1, 1, workSheet.getLastColumn()).getValues()[0];
  const lastRowWork = workSheet.getLastRow();

  for (let wRow = 2; wRow <= lastRowWork; wRow++) {
    if (!workSheet.getRange(wRow, 1).getValue()) break;
    const status = getValueByHeader(wRow, getConfig("HEADER_STATUS"), workHeaders, workSheet);
    
    if (!status || (status !== "DONE" && status !== "REJECTED" && status !== "HOLD")) {
      processRow(wRow);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA MAPPING
// ─────────────────────────────────────────────────────────────────────────────

function moveResponseToWorkingSheet(responseRow, autoProcess = true) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (e) { return; }

  try {
    const respSheet   = SS.getSheetByName(SHEET_RESPONSES);
    const workSheet   = SS.getSheetByName(SHEET_DATA);
    const configSheet = SS.getSheetByName(SHEET_CONFIG_WORKING);
    const empdbSheet  = SS.getSheetByName("empdb");

    const respHeaders  = respSheet.getRange(1, 1, 1, respSheet.getLastColumn()).getValues()[0].map(h => h.toString().trim().toLowerCase());
    const workHeaders  = workSheet.getRange(1, 1, 1, workSheet.getLastColumn()).getValues()[0].map(h => h.toString().trim().toLowerCase());
    const empdbHeaders = empdbSheet.getRange(1, 1, 1, empdbSheet.getLastColumn()).getValues()[0].map(h => h.toString().trim().toLowerCase());
    const configData   = configSheet.getDataRange().getValues();

    const colStatusToWorkIdx = respHeaders.indexOf("status to working sheet");
    if (colStatusToWorkIdx !== -1 && respSheet.getRange(responseRow, colStatusToWorkIdx + 1).getValue() === "DONE") return;

    const sourceEmailHeaderIdx = respHeaders.indexOf("email address");
    let targetUserEmail = "";
    if (sourceEmailHeaderIdx !== -1) {
      targetUserEmail = respSheet.getRange(responseRow, sourceEmailHeaderIdx + 1).getValue().toString().trim().toLowerCase();
    }

    let empdbEmailIdx = empdbHeaders.indexOf("email") !== -1 ? empdbHeaders.indexOf("email") : empdbHeaders.indexOf("email address");
    if (empdbEmailIdx === -1) empdbEmailIdx = 1;

    const empdbValues = empdbSheet.getDataRange().getValues();
    let matchedEmpdbRowValues = null;

    for (let r = 1; r < empdbValues.length; r++) {
      const currentEmpdbEmail = empdbValues[r][empdbEmailIdx] ? empdbValues[r][empdbEmailIdx].toString().trim().toLowerCase() : "";
      if (currentEmpdbEmail === targetUserEmail && targetUserEmail !== "") {
        matchedEmpdbRowValues = empdbValues[r];
        break;
      }
    }

    const targetRow    = workSheet.getLastRow() + 1;
    const newRowValues = new Array(workHeaders.length).fill("");
    const emailAddressIdx  = workHeaders.indexOf("email address");
    const emailWorkLetter  = emailAddressIdx !== -1 ? columnToLetter(emailAddressIdx + 1) : "B";

    for (let i = 1; i < configData.length; i++) {
      const headerTarget   = configData[i][0] ? configData[i][0].toString().trim() : "";
      const headerSource   = configData[i][1] ? configData[i][1].toString().trim() : "";
      const sourceSheetCfg = configData[i][2] ? configData[i][2].toString().trim().toLowerCase() : "";
      let   formulaStr     = configData[i][3] ? configData[i][3].toString().trim() : "";

      if (!headerTarget) continue;
      const targetColIdx = workHeaders.indexOf(headerTarget.toLowerCase());
      if (targetColIdx === -1) continue;

      if (sourceSheetCfg === "form responses 1" && headerSource !== "") {
        const sourceColIdx = respHeaders.indexOf(headerSource.toLowerCase());
        if (sourceColIdx !== -1) newRowValues[targetColIdx] = respSheet.getRange(responseRow, sourceColIdx + 1).getValue();
      }
      else if (sourceSheetCfg === "empdb" && headerSource !== "") {
        const empdbSourceColIdx = empdbHeaders.indexOf(headerSource.toLowerCase());
        if (empdbSourceColIdx !== -1 && matchedEmpdbRowValues) {
          newRowValues[targetColIdx] = matchedEmpdbRowValues[empdbSourceColIdx];
        } else {
          newRowValues[targetColIdx] = "Not Found";
        }
      } else if (formulaStr !== "") {
        newRowValues[targetColIdx] = formulaStr.replace(/{row}/g, targetRow).replace(/{email_col}/g, emailWorkLetter);
      }
    }

    if (colStatusToWorkIdx !== -1) respSheet.getRange(responseRow, colStatusToWorkIdx + 1).setValue("DONE");
    workSheet.getRange(targetRow, 1, 1, newRowValues.length).setValues([newRowValues]);
    
    lock.releaseLock();

    if (autoProcess) {
      SpreadsheetApp.flush();
      processRow(targetRow);
    }

  } catch (e) {
    console.error(e);
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKFLOW APPROVAL
// ─────────────────────────────────────────────────────────────────────────────

function processRow(row) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return; }
  try { _processRowInternal(row); } finally { try { lock.releaseLock(); } catch(_) {} }
}

function _processRowInternal(row) {
  const MAX_ITERATIONS = 5;
  const sheet          = SS.getSheetByName(SHEET_DATA);

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const rd = getRowData(row, sheet);
    const status = (rd.get(getConfig("HEADER_STATUS")) || "").toString().trim().toUpperCase();
    
    if (status === "REJECTED" || status === "DONE" || status === "HOLD") return;

    const hr          = (rd.get(getConfig("HEADER_HR_STATUS")) || "").toString().trim().toUpperCase();
    const l1          = (rd.get(getConfig("HEADER_L1_STATUS")) || "").toString().trim().toUpperCase();
    const l2HeaderName = getConfig("HEADER_L2_STATUS") || "Approval L2";
    const l2          = (rd.get(l2HeaderName) || "").toString().trim().toUpperCase();
    const company     = (rd.get(getConfig("HEADER_COMPANY") || "Company") || "").toString().trim().toLowerCase();

    const parseCleanNumber = (val) => {
      if (val === "" || val === null || val === undefined) return 0;
      return parseFloat(val.toString().replace(/[^0-9.-]+/g, "")) || 0;
    };

    const currentUsage = parseCleanNumber(rd.get(getConfig("HEADER_TOTAL_OVER") || "Current Usage"));
    const limit        = parseCleanNumber(rd.get(getConfig("HEADER_LIMIT") || "Limit"));
    const isOverlimit  = currentUsage > limit;

    // TAHAP 1: HR
    if (hr === "" || hr === "SENT TO HR" || hr.length === 0) {
      if (hr === "" || hr.length === 0) {
        _setColValue(sheet, row, rd, getConfig("HEADER_HR_STATUS"), "SENT TO HR");
        SpreadsheetApp.flush();
      }
      sendApprovalEmail(row, "HR");
      return; 
    }

    // TAHAP 2: L1 MANAGER
    if ((hr === "APPROVE" || hr.includes("SUPPORT SUPER ADMIN")) && (l1 === "" || l1.length === 0)) {
      sendApprovalEmail(row, "L1");
      return;
    }

    // TAHAP 3: L2 MANAGER
    if ((hr === "APPROVE" || hr.includes("SUPPORT SUPER ADMIN")) && (l1 === "APPROVE" || l1.includes("BYPASSED") || l1.includes("SUPPORT SUPER ADMIN")) && (l2 === "" || l2.length === 0)) {
      
      const isCompanyNormalFlow = company.includes("company a"); 

      if (isCompanyNormalFlow && !isOverlimit) {
        _updateApprovalRowDirect(row, "L2", "BYPASSED (Normal Flow)", new Date(), "System", sheet, rd);
        SpreadsheetApp.flush();
        continue; 
      } else {
        const updatedManagerL2 = sheet.getRange(row, rd.colIdx("L2 Manager") + 1).getValue().toString().trim();
        if (!updatedManagerL2 || updatedManagerL2 === "" || updatedManagerL2 === "-") {
          _updateApprovalRowDirect(row, "L2", "BYPASSED (No L2 Data)", new Date(), "System", sheet, rd);
          SpreadsheetApp.flush();
          continue; 
        } else {
          sendApprovalEmail(row, "L2");
          return;
        }
      }
    }

    // TAHAP 4: DONE / REJECT
    const isL1Approved = l1 === "APPROVE" || l1.includes("BYPASSED") || l1.includes("SUPPORT SUPER ADMIN");
    const isL2Approved = l2 === "APPROVE" || l2.includes("BYPASSED") || l2.includes("SUPPORT SUPER ADMIN");
    const isHRApproved = hr === "APPROVE" || hr.includes("SUPPORT SUPER ADMIN");

    if (l1.includes("REJECTED") || l2.includes("REJECTED")) {
      const colStatus = rd.headers.map(h => h.toString().trim().toLowerCase()).indexOf((getConfig("HEADER_STATUS") || "Status").toLowerCase()) + 1;
      if (colStatus > 0 && sheet.getRange(row, colStatus).getValue() !== "REJECTED") {
        sheet.getRange(row, colStatus).setValue("REJECTED");
        
        let rejectLevel = "L1";
        if (l2.includes("REJECTED")) rejectLevel = "L2";
        else if (hr.includes("REJECTED")) rejectLevel = "HR";
        
        sendRejectEmail(row, rejectLevel);
        SpreadsheetApp.flush();
      }
      return;
    }

    if (isHRApproved && isL1Approved && isL2Approved) {
      checkFinalStatus(row, rd.headers, sheet);
      return;
    }
  }
}

function _setColValue(sheet, row, rd, headerName, value) {
  const idx = rd.colIdx(headerName);
  if (idx === -1) return;
  sheet.getRange(row, idx + 1).setValue(value);
}

function _updateApprovalRowDirect(row, level, status, time, by, sheet, rd) {
  const statusHeader = getConfig(`HEADER_${level.toUpperCase()}_STATUS`) || `Approval ${level}`;
  const atHeader     = getConfig(`HEADER_${level.toUpperCase()}_AT`)     || `Approval ${level} at`;
  const byHeader     = getConfig(`HEADER_${level.toUpperCase()}_BY`)     || `Approval ${level} by`;

  _setColValue(sheet, row, rd, statusHeader, status);
  _setColValue(sheet, row, rd, atHeader, time);
  _setColValue(sheet, row, rd, byHeader, by);
}

function updateApprovalRow(row, level, status, time, by, headers, sheet) {
  const statusHeader = getConfig(`HEADER_${level.toUpperCase()}_STATUS`) || `Approval ${level}`;
  const atHeader     = getConfig(`HEADER_${level.toUpperCase()}_AT`)     || `Approval ${level} at`;
  const byHeader     = getConfig(`HEADER_${level.toUpperCase()}_BY`)     || `Approval ${level} by`;

  const mapped = headers.map(h => h.toString().trim().toLowerCase());
  const setVal = (hName, val) => {
    const idx = mapped.indexOf(hName.toString().trim().toLowerCase());
    if (idx !== -1) sheet.getRange(row, idx + 1).setValue(val);
  };

  setVal(statusHeader, status);
  setVal(atHeader, time);
  setVal(byHeader, by);
}

function checkFinalStatus(row, headers, sheet) {
  const statusHeader = getConfig("HEADER_STATUS");
  if (!statusHeader) return;

  const colStatus = headers.map(h => h.toString().trim().toLowerCase()).indexOf(statusHeader.toString().trim().toLowerCase()) + 1;
  if (colStatus <= 0) return;

  if (sheet.getRange(row, colStatus).getValue() === "DONE") return;

  sheet.getRange(row, colStatus).setValue("DONE");
  SpreadsheetApp.flush();
  
  sendRequesterDoneEmail(row, headers, sheet);
  sendHRFinanceFormEmail(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL NOTIFICATIONS
// ─────────────────────────────────────────────────────────────────────────────

function getEmailAliasConfig(companyStr) {
  let config = { alias: "", senderName: "Overlimit Approval System" };
  const company = companyStr.toLowerCase();
  
  // Ubah logika ini sesuai domain perusahaan
  if (company.includes("company a")) {
    config.alias = "admin@companya.com";
    config.senderName = "HR Admin Company A";
  } else if (company.includes("company b")) {
    config.alias = "admin@companyb.com";
    config.senderName = "HR Admin Company B";
  }
  return config;
}

function sendRequesterDoneEmail(row, headers, sheet) {
  const rd = getRowData(row, sheet);
  const requesterEmail = rd.get("Email Address");
  if (!requesterEmail || requesterEmail.toString().trim() === "") return;

  const empName  = rd.get("Employee Name") || "-";
  let managerL1  = rd.get("Manager Name") || "-";
  let managerL2  = rd.get("L2 Manager")   || "-";
  const l1Status = (rd.get(getConfig("HEADER_L1_STATUS")) || "").toString();
  const l2Status = (rd.get(getConfig("HEADER_L2_STATUS") || "Approval L2") || "").toString();

  if (l1Status.includes("BYPASSED")) managerL1 += " <i>(Bypassed by System)</i>";
  if (!managerL2 || managerL2.trim() === "" || managerL2 === "-" || l2Status.includes("BYPASSED")) {
    managerL2 = "<i>- (Dilewati, Langsung ke Finance)</i>";
  }

  const company = (rd.get(getConfig("HEADER_COMPANY") || "Company") || "").toString().trim();
  const aliasConfig = getEmailAliasConfig(company);

  const subject  = `[NOTIFIKASI] Pengajuan Overlimit Anda Telah Disetujui Manajemen`;
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.5; max-width: 600px;">
      <p>Halo <b>${empName}</b>,</p>
      <p>Pemberitahuan bahwa seluruh proses persetujuan (approval) untuk pengajuan overlimit Anda telah <b>SELESAI</b> disetujui.</p>
      <ul><li><b>HR</b></li><li><b>Pak/Bu ${managerL1}</b></li><li><b>Pak ${managerL2}</b></li></ul>
      <div style="background-color:#e2f0d9; border-left:5px solid #548235; padding:15px; margin:20px 0; border-radius:4px;">
        <p style="margin:0; color:#385723; font-size:15px;">Saat ini, proses Anda sedang dievaluasi oleh Tim Finance.</p>
      </div>
    </div>
  `;

  let mailOptions = { htmlBody: htmlBody, name: aliasConfig.senderName };
  if (aliasConfig.alias !== "") mailOptions.from = aliasConfig.alias;

  MailApp.sendEmail(requesterEmail, subject, "", mailOptions);
}

function sendHRFinanceFormEmail(row) {
  const sheet   = SS.getSheetByName(SHEET_DATA);
  const rd      = getRowData(row, sheet);
  const empName = rd.get(getConfig("HEADER_EMP_NAME"));
  const toEmail = getConfig("EMAIL_HR");
  if (!toEmail) return;

  const company = (rd.get(getConfig("HEADER_COMPANY") || "Company") || "").toString().trim();
  const aliasConfig = getEmailAliasConfig(company);

  const hrFinanceUrl = `${WEB_APP_URL_RAW}?row=${row}&action=finance_form&level=FINANCE`;
  const secureUrl    = GOOGLE_LOGIN_BRIDGE + encodeURIComponent(hrFinanceUrl);

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; color: #333;">
      <p>Dear Team Finance,</p>
      <p>Pengajuan Overlimit atas nama <b>${empName} (Baris #${row})</b> telah <b>DIAPPROVED PENUH</b>.</p>
      <div style="margin: 20px 0;">
        <a href="${secureUrl}" style="background-color:#007bff; color:white; padding:12px 25px; text-decoration:none; border-radius:5px; font-weight:bold;">
          PROSES DISBURSEMENT FINANCE
        </a>
      </div>
    </div>
  `;

  let mailOptions = { htmlBody: htmlBody, name: aliasConfig.senderName };
  if (aliasConfig.alias !== "") mailOptions.from = aliasConfig.alias;

  MailApp.sendEmail(toEmail, `[ACTION REQUIRED] Isi Form Finance Overlimit Approved - ${empName}`, "", mailOptions);
}

function sendApprovalEmail(row, level) {
  const sheet   = SS.getSheetByName(SHEET_DATA);
  const rd      = getRowData(row, sheet);

  const empName         = rd.get(getConfig("HEADER_EMP_NAME"));
  const empID           = rd.get(getConfig("HEADER_EMP_ID"));
  const managerL1       = rd.get("Manager Name");
  const managerL1Email  = rd.get(getConfig("HEADER_L1_EMAIL") || "Email Manager");
  const managerL2       = rd.get("L2 Manager");
  let   timestamp       = rd.get("Timestamp");
  const position        = rd.get(getConfig("HEADER_POSITION"));
  const alasan          = rd.get(getConfig("HEADER_ALASAN"));
  const detail          = rd.get(getConfig("HEADER_DETAIL"));
  const totalPengajuan  = formatRibuan(rd.get(getConfig("HEADER_NOMINAL")));
  const rawAttach       = rd.get(getConfig("HEADER_ATTACH"));
  const reasonL1        = rd.get(getConfig("HEADER_REASON_L1")) || "-";
  const setLimit        = formatRibuan(rd.get(getConfig("HEADER_LIMIT")));
  const totalOver       = formatRibuan(rd.get(getConfig("HEADER_TOTAL_OVER")));

  const parseCleanNumber = (val) => parseFloat(val.toString().replace(/[^0-9.-]+/g, "")) || 0;
  const currentUsageNum  = parseCleanNumber(rd.get(getConfig("HEADER_TOTAL_OVER") || "Current Usage"));
  const limitNum         = parseCleanNumber(rd.get(getConfig("HEADER_LIMIT") || "Limit"));
  const isOverlimitReq   = currentUsageNum > limitNum;

  const company = (rd.get(getConfig("HEADER_COMPANY") || "Company") || "").toString().trim();
  const aliasConfig = getEmailAliasConfig(company);

  if (timestamp instanceof Date) timestamp = Utilities.formatDate(timestamp, "GMT+7", "EEEE, dd MMM yyyy 'at' HH:mm:ss");
  else if (timestamp) {
    const d = new Date(timestamp);
    if (!isNaN(d.getTime())) timestamp = Utilities.formatDate(d, "GMT+7", "EEEE, dd MMM yyyy 'at' HH:mm:ss");
  }

  let attachHtml = "-";
  let emailAttachments = []; 
  if (rawAttach) {
    const links = rawAttach.toString().split(",");
    const listItems = links.map(link => `<li style="margin-bottom: 4px; word-break: break-all;"><a href="${link.trim()}">${link.trim()}</a></li>`).join("");
    attachHtml = `<ul style="margin: 0; padding-left: 20px;">${listItems}</ul>`;
    
    links.forEach(link => {
      const driveIdMatch = link.trim().match(/[-\w]{25,}/);
      if (driveIdMatch) {
        try { emailAttachments.push(DriveApp.getFileById(driveIdMatch[0]).getBlob()); } 
        catch (e) { }
      }
    });
  }

  const targetLevelParam = (level === "L2_SPECIAL") ? "L2" : level;
  const rawApproveUrl = `${WEB_APP_URL_RAW}?row=${row}&level=${targetLevelParam}&action=approve`;
  const rawRejectUrl
