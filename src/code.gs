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
  const rawRejectUrl  = `${WEB_APP_URL_RAW}?row=${row}&level=${targetLevelParam}&action=reject`;
  const rawHoldUrl    = `${WEB_APP_URL_RAW}?row=${row}&level=${targetLevelParam}&action=hold`;

  const secureApproveUrl = GOOGLE_LOGIN_BRIDGE + encodeURIComponent(rawApproveUrl);
  const secureRejectUrl  = GOOGLE_LOGIN_BRIDGE + encodeURIComponent(rawRejectUrl);
  const secureHoldUrl    = GOOGLE_LOGIN_BRIDGE + encodeURIComponent(rawHoldUrl);

  let toEmail = "";
  let ccEmail = getConfig(`CC_${targetLevelParam}`) || undefined;
  let subject = "";
  let htmlBody = "";

  if (level === "L2_SPECIAL" || (level === "L2" && isOverlimitReq)) {
    const l2EmailHeader = getConfig("HEADER_L2_EMAIL") || "L2 Email Manager";
    toEmail = rd.get(l2EmailHeader);
    
    let ccList = [];
    if (managerL1Email && managerL1Email.toString().trim() !== "") ccList.push(managerL1Email.toString().trim());
    const hrAdminCc = getConfig("CC_ALL_HR_ADMIN");
    if (hrAdminCc && hrAdminCc.toString().trim() !== "") ccList.push(hrAdminCc.toString().trim());
    ccEmail = ccList.length > 0 ? ccList.join(",") : undefined;

    subject = `[OVERLIMIT DETECTED] [ACTION] Approval Pengajuan Reimbursement - ${empName}`;
    const historyTableHtml = _getEmployeeHistoryTableHtml(empName, row, rd);
    const salutationName = managerL2 || "Manajemen";

    htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.5;">
        <p>Dear Pak/Bu ${salutationName},</p>
        <p>Terdapat pengajuan Overlimit baru atas nama <b>${empName} - ${position}</b> yang sudah diverifikasi awal oleh Tim HR, namun membutuhkan persetujuan dari Anda dikarenakan pengajuan ini melebihi limit toleransi yang ditetapkan (Rp${setLimit}).</p>
        <p style="margin-bottom:5px; font-weight:bold;">Berikut riwayat pengajuan periode ini:</p>
        ${historyTableHtml}
        <p style="margin-top:20px;">Mohon Approvalnya dengan klik salah satu pilihan berikut ini:</p>
        <table border="0" cellpadding="0" cellspacing="0" style="margin-top:15px; margin-bottom:20px;"><tr>
          <td style="padding-right: 10px;"><a href="${secureApproveUrl}" style="background:#28a745; padding:12px 25px; color:#fff; text-decoration:none; border-radius:5px; font-weight:bold;">APPROVED</a></td>
          <td style="padding-right: 10px;"><a href="${secureRejectUrl}" style="background:#dc3545; padding:12px 25px; color:#fff; text-decoration:none; border-radius:5px; font-weight:bold;">REJECT</a></td>
        </tr></table>
      </div>
    `;
  } else {
    let salutation = "";
    let contextText = "";
    subject = `[ACTION] Approval Pengajuan Overlimit Reimbursement - ${empName}`;

    if (level === "HR") {
      toEmail = getConfig("EMAIL_HR");
      ccEmail = getConfig("CC_HR") || undefined;
      salutation = "Team HR";
      contextText = `Terdapat pengajuan Overlimit baru atas nama <b>${empName}</b> yang membutuhkan verifikasi awal.`;
    } else if (level === "L1") {
      toEmail = rd.get(getConfig("HEADER_L1_EMAIL") || "Email Manager");
      ccEmail = getConfig("CC_ALL_HR_ADMIN") || undefined;
      salutation = managerL1;
      contextText = `Tim Anda atas nama <b>${empName} - ${position}</b> melakukan pengajuan Overlimit. Tim HR telah memverifikasi nota.`;
    } else if (level === "L2") {
      toEmail = rd.get(getConfig("HEADER_L2_EMAIL") || "L2 Email Manager");
      ccEmail = getConfig("CC_ALL_HR_ADMIN") || undefined;
      salutation = managerL2;
      contextText = `Tim Anda atas nama <b>${empName} - ${position}</b> di naungan tim <b>Pak/Bu ${managerL1}</b> melakukan pengajuan Overlimit. Pengajuan ini telah disetujui Atasan Langsung dengan alasan: <b>${reasonL1}</b>. Kami membutuhkan validasi akhir dari Anda.`;
    }

    htmlBody = `
      <div style="font-family: Arial, sans-serif; color: #333;">
        <p>Dear Pak/Bu ${salutation},</p>
        <p>${contextText}</p>
        <table style="border-collapse:collapse; width:100%; max-width:600px; margin-bottom:20px;">
          <tr><td style="padding:8px; border:1px solid #ddd; background:#f9f9f9; width:30%;"><b>Tanggal</b></td><td style="padding:8px; border:1px solid #ddd;">${timestamp}</td></tr>
          <tr><td style="padding:8px; border:1px solid #ddd; background:#f9f9f9;"><b>Nama</b></td><td style="padding:8px; border:1px solid #ddd;">${empName} (ID: ${empID})</td></tr>
          <tr><td style="padding:8px; border:1px solid #ddd; background:#f9f9f9;"><b>Posisi</b></td><td style="padding:8px; border:1px solid #ddd;">${position}</td></tr>
          <tr><td style="padding:8px; border:1px solid #ddd; background:#f9f9f9;"><b>Jumlah Pengajuan</b></td><td style="padding:8px; border:1px solid #ddd;">Rp${totalPengajuan}</td></tr>
          <tr><td style="padding:8px; border:1px solid #ddd; background:#f9f9f9;"><b>Limit</b></td><td style="padding:8px; border:1px solid #ddd;">Rp${setLimit}</td></tr>
          <tr><td style="padding:8px; border:1px solid #ddd; background:#f9f9f9;"><b>Total Overlimit Bulan ini</b></td><td style="padding:8px; border:1px solid #ddd;">Rp${totalOver}</td></tr>
          <tr><td style="padding:8px; border:1px solid #ddd; background:#f9f9f9;"><b>Alasan</b></td><td style="padding:8px; border:1px solid #ddd;">${alasan} - ${detail}</td></tr>
          <tr><td style="padding:8px; border:1px solid #ddd; background:#f9f9f9;"><b>Attachment</b></td><td style="padding:8px; border:1px solid #ddd;">${attachHtml}</td></tr>
        </table>
        <p>Mohon Approvalnya dengan klik salah satu pilihan berikut ini:</p>
        <table border="0" cellpadding="0" cellspacing="0" style="margin-top:25px; margin-bottom:20px;"><tr>
          <td style="padding-right: 10px;"><a href="${secureApproveUrl}" style="background:#28a745; padding:12px 25px; color:#fff; text-decoration:none; border-radius:5px; font-weight:bold;">APPROVED</a></td>
          <td style="padding-right: 10px;"><a href="${secureRejectUrl}" style="background:#dc3545; padding:12px 25px; color:#fff; text-decoration:none; border-radius:5px; font-weight:bold;">REJECT</a></td>
          ${level === "HR" ? `<td style="padding-right: 10px;"><a href="\${secureHoldUrl}" style="background:#ffc107; padding:12px 25px; color:#212529; text-decoration:none; border-radius:5px; font-weight:bold;">HOLD</a></td>` : ""}
        </tr></table>
      </div>
    `;
  }

  if (!toEmail) return;

  let mailOptions = { cc: ccEmail, htmlBody: htmlBody, attachments: emailAttachments, name: aliasConfig.senderName };
  if (aliasConfig.alias !== "") mailOptions.from = aliasConfig.alias;

  MailApp.sendEmail(toEmail, subject, "", mailOptions);
}

function sendRejectEmail(row, level) {
  const sheet = SS.getSheetByName(SHEET_DATA);
  const rd    = getRowData(row, sheet);
  
  const empStatusHeader = getConfig("HEADER_EMPLOYMENT_STATUS") || "Employment Status";
  const empStatus = (rd.get(empStatusHeader) || "").toString().trim().toLowerCase();
  
  let requesterEmail = "";
  if (empStatus.includes("ex-karyawan")) requesterEmail = rd.get(getConfig("HEADER_REQUESTER") || "Requester Email") || rd.get("Email Address");
  else requesterEmail = rd.get(getConfig("HEADER_EMP_EMAIL") || "Employee Email") || rd.get("Email Address");
  
  if (!requesterEmail || requesterEmail.toString().trim() === "") return;

  const empName      = rd.get(getConfig("HEADER_EMP_NAME")) || "Karyawan";
  const reasonReject = rd.get(getConfig(`HEADER_REASON_${level.toUpperCase()}`)) || "Tidak ada alasan spesifik.";
  const rawTimestamp = rd.get("Timestamp");
  const rawNominal   = rd.get(getConfig("HEADER_NOMINAL"));
  const alasanOri    = rd.get(getConfig("HEADER_ALASAN")) || "-";
  const rawAttach    = rd.get(getConfig("HEADER_ATTACH"));
  const company      = (rd.get(getConfig("HEADER_COMPANY") || "Company") || "").toString().trim();

  let tglFormatted = "-";
  if (rawTimestamp instanceof Date) tglFormatted = Utilities.formatDate(rawTimestamp, "GMT+7", "dd MMM yyyy");
  else if (rawTimestamp) {
    const d = new Date(rawTimestamp);
    if (!isNaN(d.getTime())) tglFormatted = Utilities.formatDate(d, "GMT+7", "dd MMM yyyy");
  }
  
  const nominalStr = "Rp" + formatRibuan(rawNominal);

  let attachHtml = "";
  if (rawAttach) {
    attachHtml = rawAttach.toString().split(",").map(url => {
      if (url.trim()) return `<a href="${url.trim()}" target="blank" style="color:#2563eb;">${url.trim()}</a>`;
      return "";
    }).filter(Boolean).join("<br>");
  }

  const aliasConfig = getEmailAliasConfig(company);
  const subject  = `[REJECTION] Pengajuan Overlimit Reimbursement Anda Ditolak`;
  const htmlBody = `
    <div style="font-family: Arial, sans-serif; color: #333; line-height: 1.5; max-width: 600px;">
      <p>Hi <b>${empName}</b>,</p>
      <p>Mohon maaf, pengajuan reimbursement Anda pada tanggal <b>${tglFormatted}</b> dengan nominal <b>${nominalStr}</b> (Alasan: "${alasanOri}") telah <b>DITOLAK</b> pada tahapan persetujuan <b>${level}</b> dengan alasan:</p>
      <div style="background-color:#f8d7da; border-left:5px solid #dc3545; padding:15px; margin:15px 0; border-radius:4px;">
        <p style="margin:0; color:#721c24; font-size:14px;"><b>"${reasonReject}"</b></p>
      </div>
      <p>Mohon dapat menghubungi pihak HR untuk melakukan validasi.</p>
      <p style="margin-top:20px;"><b>Attachment pendukung Anda:</b><br>${attachHtml || "-"}</p>
      <hr style="border:0; border-top:1px solid #eee; margin-top:25px;">
      <p style="font-size:11px; color:#777; font-style:italic;">Pesan ini dikirim otomatis oleh Sistem Approval Reimbursement Internal.</p>
    </div>
  `;

  let mailOptions = { cc: getConfig("CC_ALL_HR_ADMIN") || undefined, htmlBody: htmlBody, name: aliasConfig.senderName };
  if (aliasConfig.alias !== "") mailOptions.from = aliasConfig.alias;

  MailApp.sendEmail(requesterEmail, subject, "", mailOptions);
}

function _getEmployeeHistoryTableHtml(empName, currentReqRow, currentRd) {
  const sheet = SS.getSheetByName(SHEET_DATA);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => h.toString().trim().toLowerCase());
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "<p style='color:#777;'>Tidak ada riwayat penggunaan.</p>";
  
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  const idxName = headers.indexOf(getConfig("HEADER_EMP_NAME").toLowerCase());
  const idxDate = headers.indexOf("timestamp");
  const idxNominal = headers.indexOf(getConfig("HEADER_NOMINAL").toLowerCase());
  const idxAlasan = headers.indexOf(getConfig("HEADER_ALASAN").toLowerCase());
  const idxAttach = headers.indexOf(getConfig("HEADER_ATTACH").toLowerCase());

  let targetMonth = -1, targetYear = -1;
  const currentTimestamp = currentRd.get("Timestamp");
  if (currentTimestamp instanceof Date) {
    targetMonth = currentTimestamp.getMonth(); 
    targetYear = currentTimestamp.getFullYear();
  }

  let tableRowsHtml = "", totalAkumulasi = 0;

  for (let i = 0; i < data.length; i++) {
    const rowNum = i + 2;
    if (data[i][idxName] && data[i][idxName].toString().trim().toLowerCase() === empName.toString().trim().toLowerCase()) {
      const rowDateRaw = data[i][idxDate];
      let rowDateObj = null;
      if (rowDateRaw instanceof Date) rowDateObj = rowDateRaw;

      if (targetMonth !== -1 && rowDateObj && (rowDateObj.getMonth() !== targetMonth || rowDateObj.getFullYear() !== targetYear)) continue;

      const idxStatus = headers.indexOf((getConfig("HEADER_STATUS") || "Status").toLowerCase());
      if (idxStatus !== -1 && data[i][idxStatus].toString().trim().toUpperCase() === "REJECTED") continue;

      let dateFormatted = rowDateObj ? Utilities.formatDate(rowDateObj, "GMT+7", "dd MMM yyyy HH:mm") : "-";
      const numericVal = Number(data[i][idxNominal].toString().replace(/[^0-9.-]+/g, "")) || 0;
      totalAkumulasi += numericVal;

      const nominalFormatted = "Rp" + new Intl.NumberFormat('en-US').format(numericVal);
      const alasan = data[i][idxAlasan] || "-";
      
      let attachCellHtml = "-";
      if (data[i][idxAttach]) attachCellHtml = data[i][idxAttach].toString().split(",").map(link => `<a href="${link.trim()}" target="blank" style="color:#2563eb;">Link</a>`).join("<br>");
      
      const rowStyle = (rowNum === currentReqRow) ? "background-color: #fff3cd; font-weight: bold;" : "";
      tableRowsHtml += `<tr style="${rowStyle}"><td style="padding:8px; border:1px solid #cbd5e1;">${dateFormatted}</td><td style="padding:8px; border:1px solid #cbd5e1;">${nominalFormatted}</td><td style="padding:8px; border:1px solid #cbd5e1;">${alasan}</td><td style="padding:8px; border:1px solid #cbd5e1; font-size:11px;">${attachCellHtml}</td></tr>`;
    }
  }

  if (!tableRowsHtml) return "<p style='color:#777;'>Tidak ditemukan riwayat pengajuan bulan ini.</p>";

  const grandTotalFormatted = "Rp" + new Intl.NumberFormat('en-US', { minimumFractionDigits: 2 }).format(totalAkumulasi);
  return `<table style="border-collapse: collapse; width: 100%; font-size: 13px; color: #333;"><thead><tr style="background-color: #f1f5f9;"><th style="padding:10px; border:1px solid #cbd5e1;">Tanggal</th><th style="padding:10px; border:1px solid #cbd5e1;">Jumlah</th><th style="padding:10px; border:1px solid #cbd5e1;">Alasan</th><th style="padding:10px; border:1px solid #cbd5e1;">Attachment</th></tr></thead><tbody>${tableRowsHtml}<tr style="background-color:#f8fafc;font-weight:bold;"><td style="padding:10px;border:1px solid #cbd5e1;">Total</td><td style="padding:10px;border:1px solid #cbd5e1;color:#b91c1c;">${grandTotalFormatted}</td><td colspan="2" style="border:1px solid #cbd5e1;"></td></tr></tbody></table>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// WEB APP CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const row    = (e && e.parameter && e.parameter.row)    ? e.parameter.row.toString().trim()    : "";
    const action = (e && e.parameter && e.parameter.action) ? e.parameter.action.toString().trim() : "";
    const level  = (e && e.parameter && e.parameter.level)  ? e.parameter.level.toString().trim()  : "";

    if (!row || !action || !level) return HtmlService.createHtmlOutput("<h3>Error: Parameter URL tidak lengkap.</h3>");

    const sheet = SS.getSheetByName(SHEET_DATA);
    const rd    = getRowData(parseInt(row), sheet);

    if (!rd.get(getConfig("HEADER_EMP_NAME") || "Employee Name")) return HtmlService.createHtmlOutput("<h3 style='color:#dc3545; text-align:center;'>⚠️ Data Tidak Ditemukan! (Dihapus dari Sheet)</h3>");

    const getLevelStatus = (lvl) => (rd.get(getConfig(`HEADER_${lvl}_STATUS`) || `Approval ${lvl}`) || "").toString().toUpperCase();
    const isHRApprovedRaw = getLevelStatus("HR") === "APPROVE" || getLevelStatus("HR").includes("SUPPORT SUPER ADMIN");
    const isL1ApprovedRaw = getLevelStatus("L1") === "APPROVE" || getLevelStatus("L1").includes("BYPASSED") || getLevelStatus("L1").includes("SUPPORT SUPER ADMIN");

    if (level.toUpperCase() === "L1" && !isHRApprovedRaw) return HtmlService.createHtmlOutput("<h3 style='color:red; text-align:center;'>⚠️ Menunggu HR terlebih dahulu.</h3>");
    if (level.toUpperCase() === "L2" && !isL1ApprovedRaw) return HtmlService.createHtmlOutput("<h3 style='color:red; text-align:center;'>⚠️ Menunggu L1 terlebih dahulu.</h3>");

    if (action === "finance_form") {
      if (rd.get("Sent to Finance") === "DONE") return HtmlService.createHtmlOutput("<h3 style='color:#dc3545; text-align:center;'>⚠️ Data sudah pernah dikirim ke Finance.</h3>");
      return showFinanceFormUI(row);
    }

    const currentLevelStatus = rd.get(getConfig(`HEADER_${level.toUpperCase()}_STATUS`) || "Approval L2");
    if (currentLevelStatus === "APPROVE" || currentLevelStatus === "REJECT" || (currentLevelStatus && currentLevelStatus.toString().includes("BYPASSED"))) {
      return HtmlService.createHtmlOutput("<h3 style='text-align:center; margin-top:50px;'>⚠️ Pilihan tidak dapat diubah. Keputusan sudah tersimpan.</h3>");
    }

    const activeUserEmail = Session.getActiveUser().getEmail() || "";
    if (activeUserEmail === "") return HtmlService.createHtmlOutput("<h3>❌ Sesi Google Tidak Terdeteksi</h3>");

    const superAdminCfg = getConfig("EMAIL_SUPER_ADMIN") || "";
    const superAdminList = superAdminCfg.split(",").map(email => email.trim().toLowerCase());
    const isSuperAdmin = superAdminList.includes(activeUserEmail.toLowerCase());

    let intendedEmail = "";
    if (level === "HR") intendedEmail = getConfig("EMAIL_HR") || "";
    else if (level === "L1") intendedEmail = rd.get(getConfig("HEADER_L1_EMAIL") || "Email Manager") || "";
    else if (level === "L2") intendedEmail = rd.get(getConfig("HEADER_L2_EMAIL") || "L2 Email Manager") || "";

    if (!isSuperAdmin && intendedEmail && !intendedEmail.toLowerCase().includes(activeUserEmail.toLowerCase())) {
      return HtmlService.createHtmlOutput("<h3>❌ Akses Ditolak! Email Anda tidak berwenang.</h3>");
    }

    return showReasonForm(row, level, action, isSuperAdmin);
  } catch (error) {
    return HtmlService.createHtmlOutput("<h3>Terjadi kesalahan:</h3><pre>" + error.stack + "</pre>");
  }
}

function showReasonForm(row, level, action, isSuperAdmin) {
  const safeAction = action ? action.toString() : "";
  const actionText = safeAction.toUpperCase();
  let themeColor = action === "approve" ? "#28a745" : "#dc3545";
  if (action === "hold") themeColor = "#ffc107";

  const sheet = SS.getSheetByName(SHEET_DATA);
  const rd = getRowData(parseInt(row), sheet);
  const nominalAwal = rd.get(getConfig("HEADER_NOMINAL") || "Total Pengajuan") || 0;

  let template = HtmlService.createTemplateFromFile('FormReason');
  template.row = row;
  template.level = level;
  template.action = safeAction;
  template.actionText = actionText;
  template.themeColor = themeColor;
  template.nominalAwal = nominalAwal;
  template.isSuperAdmin = isSuperAdmin;

  return template.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function showFinanceFormUI(row) {
  const sheet = SS.getSheetByName(SHEET_DATA);
  const rd    = getRowData(parseInt(row), sheet);

  const fmtDate = (v) => (v instanceof Date) ? Utilities.formatDate(v, "GMT+7", "dd MMM yyyy HH:mm:ss") : (v || "-");
  const rawAmount = rd.get(getConfig("HEADER_NOMINAL") || "Total Pengajuan") || 0;

  const deptRaw = (rd.get("Department") || "").toString().toUpperCase();
  let deptCode = "OPS";
  if (deptRaw.includes("COMMERCIAL")) deptCode = "COM";
  else if (deptRaw.includes("OPERATIONS")) deptCode = "OPS";
  else deptCode = deptRaw || "DEPT";

  const hrBy = rd.get(getConfig("HEADER_HR_BY") || "Approval HR by") || "-";
  const hrAt = fmtDate(rd.get(getConfig("HEADER_HR_AT") || "Approval HR at"));
  const hrReason = rd.get(getConfig("HEADER_REASON_HR") || "Reason By HR") || "-";
  const l1By = rd.get(getConfig("HEADER_L1_BY") || "Approval L1 by") || "-";
  const l1At = fmtDate(rd.get(getConfig("HEADER_L1_AT") || "Approval L1 at"));
  const l1Reason = rd.get(getConfig("HEADER_REASON_L1") || "Reason By L1") || "-";
  const l2By = rd.get(getConfig("HEADER_L2_BY") || "Approval L2 by") || "-";
  const l2At = fmtDate(rd.get(getConfig("HEADER_L2_AT") || "Approval L2 at"));
  const l2Reason = rd.get(getConfig("HEADER_REASON_L2") || "Reason By L2") || "-";

  let template = HtmlService.createTemplateFromFile('FormFinance');
  template.row = row;
  template.themeColor = "#007bff";
  template.company = rd.get(getConfig("HEADER_COMPANY") || "Company") || "-";
  template.empName = rd.get(getConfig("HEADER_EMP_NAME") || "Employee Name") || "-";
  template.bankName = rd.get(getConfig("HEADER_NAMA_BANK") || "Nama Bank") || "-";
  template.bankAccNo = rd.get(getConfig("HEADER_REKENING") || "No Rekening") || "-";
  template.bankAccName = rd.get(getConfig("HEADER_PEMILIK_BANK") || "Nama Pemilik Rekening") || "-";
  template.amountFormatted = formatRibuan(rawAmount);
  template.region = rd.get(getConfig("HEADER_REGION") || "Region") || "-";
  template.cmDivisi = `${deptCode}`;

  template.logApprovalHtml = `<ul style="list-style-type: disc; margin-left: 20px; padding-left: 10px;">` +
    `<li style="margin-bottom: 5px;"><b>HR Approved by:</b> ${hrBy} at ${hrAt} dengan catatan ${hrReason}</li>` +
    `<li style="margin-bottom: 5px;"><b>Direct Manager by:</b> ${l1By} at ${l1At} dengan alasan ${l1Reason}</li>` +
    `<li style="margin-bottom: 5px;"><b>Head Business by:</b> ${l2By} at ${l2At} dengan alasan ${l2Reason}</li>` +
  `</ul>`;
  
  const rawLog = `HR Approved: ${hrBy} at ${hrAt} (${hrReason})\nL1 Approved: ${l1By} at ${l1At} (${l1Reason})\nL2 Approved: ${l2By} at ${l2At} (${l2Reason})`;
  template.base64LogApproval = Utilities.base64Encode(rawLog, Utilities.Charset.UTF_8);

  return template.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function executeApprovalFromWeb(data) {
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return "<h3 style='color:red;'>❌ Sistem sibuk, coba beberapa saat lagi.</h3>"; }

  try {
    const row       = parseInt(data.row);
    const sheet     = SS.getSheetByName(SHEET_DATA);
    const rd        = getRowData(row, sheet);
    
    if (!rd.get("Employee Name")) return "<h3 style='color:#dc3545;'>❌ Gagal: Data sudah dihapus dari sistem.</h3>";

    const headers   = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const userEmail = Session.getActiveUser().getEmail() || "Authorized User";

    const superAdminCfg = getConfig("EMAIL_SUPER_ADMIN") || "";
    const superAdminList = superAdminCfg.split(",").map(email => email.trim().toLowerCase());
    const isSuperAdmin = superAdminList.includes(userEmail.toLowerCase());

    let approverNameLog = userEmail; 
    
    if (isSuperAdmin) {
      let fileUrl = "";
      if (data.fileBase64 && data.fileMimeType && data.fileName) {
        try {
          // GANTI DENGAN FOLDER ID DRIVE SUPER ADMIN ANDA
          const folderId = "YOUR_SUPERADMIN_FOLDER_ID_HERE"; 
          const fileBlob = Utilities.newBlob(Utilities.base64Decode(data.fileBase64), data.fileMimeType, `Bukti_SuperAdmin_Row_${row}_${data.fileName}`);
          const uploadedFile = DriveApp.getFolderById(folderId).createFile(fileBlob);
          fileUrl = uploadedFile.getUrl();
        } catch (errUpload) {}
      }
      
      if (fileUrl !== "") approverNameLog = `=HYPERLINK("${fileUrl}", "Support by Super Admin")`;
      else approverNameLog = "Support by Super Admin (Tanpa Lampiran)";
    }

    const reasonHeaderKey = `HEADER_REASON_${data.level.toUpperCase()}`;
    const reasonHeader    = (getConfig(reasonHeaderKey) || `Reason By ${data.level.toUpperCase()}`).toString().trim().toLowerCase();
    const colReason       = headers.map(h => h.toString().trim().toLowerCase()).indexOf(reasonHeader) + 1;
    if (colReason > 0) sheet.getRange(row, colReason).setValue(data.reason);

    let statusText = data.action === "approve" ? "APPROVE" : (data.action === "reject" ? "REJECT" : "HOLD");
    if (isSuperAdmin) {
      if (data.action === "approve") statusText = "APPROVE - SUPPORT SUPER ADMIN";
      else if (data.action === "reject") statusText = "REJECTED - SUPPORT SUPER ADMIN"; 
    }

    if (data.action === "hold") {
      updateApprovalRow(row, data.level, statusText, new Date(), approverNameLog, headers, sheet);
      const colStatus = headers.map(h => h.toString().trim().toLowerCase()).indexOf((getConfig("HEADER_STATUS") || "Status").toLowerCase()) + 1;
      if (colStatus > 0) sheet.getRange(row, colStatus).setValue("HOLD");
      const colHoldDate = headers.map(h => h.toString().trim().toLowerCase()).indexOf("tgl reminder hold") + 1;
      if (colHoldDate > 0 && data.holdDate) sheet.getRange(row, colHoldDate).setValue(new Date(data.holdDate));
      SpreadsheetApp.flush();
      return "<h3 style='color:#ffc107;'>🟡 Sukses! Status di-HOLD internal oleh Super Admin.</h3>";
    }

    if (data.action === "approve") {
      if (data.level === "HR" && data.newNominal) {
        const colNominal = rd.colIdx(getConfig("HEADER_NOMINAL") || "Total Pengajuan") + 1;
        if (colNominal > 0) sheet.getRange(row, colNominal).setValue(Number(data.newNominal.replace(/[^0-9.-]+/g, "")));
      }
      const colStatus = headers.map(h => h.toString().trim().toLowerCase()).indexOf((getConfig("HEADER_STATUS") || "Status").toLowerCase()) + 1;
      if (colStatus > 0) sheet.getRange(row, colStatus).setValue(""); 

      updateApprovalRow(row, data.level, statusText, new Date(), approverNameLog, headers, sheet);
      SpreadsheetApp.flush();
      
      lock.releaseLock(); 
      processRow(row); 
      return `<h3 style='color:#28a745;'>✔️ Sukses! Aksi ${statusText} berhasil dicatat.</h3>`;
    } 
    
    else {
      updateApprovalRow(row, data.level, statusText, new Date(), approverNameLog, headers, sheet);
      const colStatus = headers.map(h => h.toString().trim().toLowerCase()).indexOf((getConfig("HEADER_STATUS") || "").toString().trim().toLowerCase()) + 1;
      if (colStatus > 0) sheet.getRange(row, colStatus).setValue("REJECTED");
      sendRejectEmail(row, data.level); 
      SpreadsheetApp.flush();
      return `<h3 style='color:#dc3545;'>❌ Permohonan telah di-${statusText}.</h3>`;
    }
  } catch(e) {
    return "<h3 style='color:red;'>❌ Terjadi kesalahan sistem internal.</h3>";
  } finally {
    try { lock.releaseLock(); } catch(_) {}
  }
}

function executeFinanceFormSubmission(data) {
  try {
    const row     = parseInt(data.row);
    const sheet   = SS.getSheetByName(SHEET_DATA);
    const rd      = getRowData(row, sheet);

    if (!rd.get("Employee Name")) return `<h3 style='color:#dc3545;'>❌ Gagal Memproses Form: Data hilang.</h3>`;
    if (rd.get("Sent to Finance") === "DONE") return `<h3 style='color:#dc3545;'>❌ Gagal: Data sudah dikirim ke Finance.</h3>`;

    const fileBlob = Utilities.newBlob(Utilities.base64Decode(data.base64), data.mimeType, `Bukti_Submital_Row_${row}_${data.fileName}`);
    const uploadedFile = DriveApp.getFolderById(FOLDER_SCREENSHOT_ID).createFile(fileBlob);
    
    const colLampiranFinanceIdx = rd.colIdx("Lampiran ke Finance");
    if (colLampiranFinanceIdx !== -1) sheet.getRange(row, colLampiranFinanceIdx + 1).setValue(uploadedFile.getUrl());

    const attachmentsArray = [uploadedFile.getBlob()];
    const rawAttach = rd.get("Lampiran Pendukung");
    if (rawAttach) {
      rawAttach.toString().split(",").forEach(link => {
        const match = link.trim().match(/[-\w]{25,}/);
        if (match) { try { attachmentsArray.push(DriveApp.getFileById(match[0]).getBlob()); } catch (e) {} }
      });
    }

    const company = rd.get("Company") || "-", empName = rd.get("Employee Name") || "-";
    const finalAmtFormatted = formatRibuan(rd.get(getConfig("HEADER_NOMINAL")) || 0);
    const financeEmailTarget = getConfig("EMAIL_FINANCE");

    if (!financeEmailTarget) return "<h3 style='color:red;'>❌ Konfigurasi email Finance tidak ditemukan.</h3>";

    // SLA FINANCE DUE DATE CALCULATION
    const nowSubmitDate = new Date();
    const day = nowSubmitDate.getDay(); 
    const hour = nowSubmitDate.getHours();
    let dueDate = new Date(nowSubmitDate);
    let addDays = 0;

    if ((day === 4 && hour >= 16) || day === 5 || day === 6 || day === 0 || (day === 1 && hour < 16)) {
      if (day === 4) addDays = 7;     
      else if (day === 5) addDays = 6; 
      else if (day === 6) addDays = 5; 
      else if (day === 0) addDays = 4; 
      else if (day === 1) addDays = 3; 
    } else {
      if (day === 1) addDays = 8;     
      else if (day === 2) addDays = 7; 
      else if (day === 3) addDays = 6; 
      else if (day === 4) addDays = 5; 
    }

    dueDate.setDate(nowSubmitDate.getDate() + addDays);
    const dueDateFormatted = Utilities.formatDate(dueDate, "GMT+7", "EEE, dd MMM yyyy");
    
    const colDueDateFinanceIdx = rd.colIdx("Due Date Finance");
    if (colDueDateFinanceIdx !== -1) {
      sheet.getRange(row, colDueDateFinanceIdx + 1).setValue(dueDateFormatted);
    }

    const financeHtmlBody = `
      <div style="font-family:Arial, sans-serif; line-height:1.5; color:#333;">
        <p>Dear Finance,</p>
        <p>Mohon diproses untuk pengajuan disbursement atas nama <b>${empName} (${company})</b> sebesar <b>Rp${finalAmtFormatted}</b>.</p>
        
        <div style="background-color:#fff3cd; border-left:5px solid #ffc107; padding:12px; margin:15px 0; border-radius:4px;">
          <p style="margin:0; font-size:14px; color:#856404;">
            📅 <b>Estimasi Jadwal Pencairan (Due Date):</b> <span style="font-weight:bold; color:#d9534f;">${dueDateFormatted}</span><br>
            <small><i>(Dihitung otomatis berdasarkan SLA waktu submit form Finance Control)</i></small>
          </p>
        </div>

        <p><b>Log Approval Internal Manajemen:</b><br>
        <i style="white-space:pre-line; color:#555; background:#f8fafc; display:block; padding:10px; border:1px solid #e2e8f0; border-radius:4px;">${data.logApproval}</i></p>
      </div>
    `;

    const targetEmail = String(financeEmailTarget || "").trim();
    if (!targetEmail) throw new Error("Email Finance tidak terkonfigurasi atau bernilai kosong.");
    const validAttachments = (attachmentsArray || []).filter(item => item != null);

    MailApp.sendEmail({
      to:          targetEmail,
      subject:     `[REIMBURSEMENT] Overlimit Form - ${empName}`,
      htmlBody:    financeHtmlBody,
      attachments: validAttachments
    });
    
    const colSentFinanceIdx = rd.colIdx("Sent to Finance");
    if (colSentFinanceIdx !== -1) sheet.getRange(row, colSentFinanceIdx + 1).setValue("DONE");

    SpreadsheetApp.flush();
    return `<h3 style='color:#28a745;'>✔️ Pengajuan Berhasil Disubmit ke Finance! (Due Date: ${dueDateFormatted})</h3>`;

  } catch (error) {
    return `<h3 style='color:red;'>❌ Gagal Memproses Form</h3><p>${error.toString()}</p>`;
  }
}

function cekReminderHold() {
  const ws = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DATA);
  if (!ws) return;
  const data = ws.getDataRange().getValues();
  const headers = data[0];

  const statusIdx   = headers.indexOf(getConfig("HEADER_STATUS") || "Status");
  const holdDateIdx = headers.indexOf(getConfig("HEADER_HR_AT"));
  const hrStatusIdx = headers.indexOf(getConfig("HEADER_HR_STATUS") || "Approval HR");

  if (statusIdx === -1 || holdDateIdx === -1) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 1; i < data.length; i++) {
    if (data[i][statusIdx] === "HOLD") {
      const hDate = data[i][holdDateIdx];
      
      if (hDate instanceof Date) {
        const targetHoldDate = new Date(hDate);
        targetHoldDate.setHours(0, 0, 0, 0);
        
        if (today.getTime() >= targetHoldDate.getTime()) {
          const currentRow = i + 1;
          sendApprovalEmail(currentRow, "HR"); 
          
          if (hrStatusIdx !== -1) ws.getRange(currentRow, hrStatusIdx + 1).setValue("SENT TO HR");
          ws.getRange(currentRow, statusIdx + 1).setValue(""); 
          ws.getRange(currentRow, holdDateIdx + 1).setValue(""); 
          
          SpreadsheetApp.flush();
        }
      }
    }
  }
}

function resendRejectEmailViaPrompt() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt('Kirim Ulang Email Penolakan', 'Masukkan NOMOR BARIS data di Spreadsheet yang ingin dikirim ulang email reject-nya:', ui.ButtonSet.OK_CANCEL);

  if (response.getSelectedButton() === ui.Button.OK) {
    const inputRow = response.getResponseText().trim();
    const targetRow = parseInt(inputRow, 10);

    if (isNaN(targetRow) || targetRow < 2) {
      ui.alert('❌ Error', 'Nomor baris tidak valid! Silakan masukkan angka baris yang benar (minimal baris 2).', ui.ButtonSet.OK);
      return;
    }

    try {
      sendRejectEmail(targetRow, "HR"); 
      ui.alert('✅ Berhasil', `Email penolakan untuk BARIS ${targetRow} telah berhasil dikirim ulang.`, ui.ButtonSet.OK);
    } catch (error) {
      ui.alert('❌ Gagal', `Terjadi kesalahan saat mengirim email: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}
