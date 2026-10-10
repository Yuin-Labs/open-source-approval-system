
/**
- Fungsi Utama untuk memindahkan data secara dinamis berdasarkan konfigurasi
- dari sheet "Config to Report" dengan filter Status DONE & penanda Move to report.
*/
function moveWorkingDataToRawData() {
  // GANTI DENGAN SPREADSHEET ID ANDA
  const SOURCE_SS_ID = "YOUR_SOURCE_SS_ID_HERE";
  const SOURCE_SHEET_NAME = "Working Sheet";
  const CONFIG_SHEET_NAME = "Config to Report";
  
  // GANTI DENGAN SPREADSHEET ID TARGET (ARCHIVE) ANDA
  const TARGET_SS_ID = "YOUR_TARGET_SS_ID_HERE";
  const TARGET_SHEET_NAME = "Raw Data Overlimit Reimbursement";

  console.log("=== Memulai Proses Pemindahan Data ===");

  try {
    const sourceSheets = SpreadsheetApp.openById(SOURCE_SS_ID);
    const sourceSheet = sourceSheets.getSheetByName(SOURCE_SHEET_NAME);
    const configSheet = sourceSheets.getSheetByName(CONFIG_SHEET_NAME);
    
    const targetSheets = SpreadsheetApp.openById(TARGET_SS_ID);
    const targetSheet = targetSheets.getSheetByName(TARGET_SHEET_NAME);

    if (!sourceSheet) throw new Error(`Sheet sumber "${SOURCE_SHEET_NAME}" tidak ditemukan.`);
    if (!configSheet) throw new Error(`Sheet konfigurasi "${CONFIG_SHEET_NAME}" tidak ditemukan.`);
    if (!targetSheet) throw new Error(`Sheet target "${TARGET_SHEET_NAME}" tidak ditemukan.`);

    const configValues = configSheet.getDataRange().getValues();
    const configHeader = configValues[0];
    
    const targetIdx = configHeader.findIndex(h => h.toString().trim() === "Target Header");
    const sourceIdx = configHeader.findIndex(h => h.toString().trim() === "Source Header");
    
    if (targetIdx === -1 || sourceIdx === -1) {
      throw new Error("Header 'Target Header' atau 'Source Header' tidak ditemukan di sheet Config to Report.");
    }

    const headerMapping = {};
    const targetHeadersOrder = [];

    for (let i = 1; i < configValues.length; i++) {
      const targetHead = configValues[i][targetIdx]?.toString().trim();
      const sourceHead = configValues[i][sourceIdx]?.toString().trim() || "";
      if (targetHead) {
        headerMapping[targetHead] = sourceHead;
        targetHeadersOrder.push(targetHead);
      }
    }

    const sourceValues = sourceSheet.getDataRange().getValues();
    if (sourceValues.length < 2) return;
    
    const sourceHeader = sourceValues[0];
    const sourceData = sourceValues.slice(1);

    const statusColIdx = sourceHeader.findIndex(h => h.toString().trim() === "Status");
    const moveToReportColIdx = sourceHeader.findIndex(h => h.toString().trim() === "Move to report");

    if (statusColIdx === -1) throw new Error("Kolom header 'Status' tidak ditemukan di Working Sheet.");
    if (moveToReportColIdx === -1) throw new Error("Kolom header 'Move to report' tidak ditemukan di Working Sheet.");

    const moveToReportRange = sourceSheet.getRange(2, moveToReportColIdx + 1, sourceData.length, 1);
    const moveToReportValues = moveToReportRange.getValues();

    const sourceHeaderIndexMap = {};
    sourceHeader.forEach((header, index) => {
      sourceHeaderIndexMap[header.toString().trim()] = index;
    });

    const transformedData = [];
    let skippedCount = 0;

    sourceData.forEach((row, rowIndex) => {
      const statusValue = row[statusColIdx]?.toString().trim().toUpperCase();
      const moveStatusValue = row[moveToReportColIdx]?.toString().trim().toUpperCase();
      
      if (statusValue === "DONE" && moveStatusValue !== "DONE") {
        const newRow = [];
        targetHeadersOrder.forEach(targetHeader => {
          const sourceHeaderName = headerMapping[targetHeader];
          if (sourceHeaderName && sourceHeaderIndexMap[sourceHeaderName] !== undefined) {
            newRow.push(row[sourceHeaderIndexMap[sourceHeaderName]]);
          } else {
            newRow.push("");
          }
        });
        
        transformedData.push(newRow);
        moveToReportValues[rowIndex][0] = "DONE";
        
      } else if (statusValue === "DONE" && moveStatusValue === "DONE") {
        skippedCount++; 
      }
    });

    if (transformedData.length > 0) {
      if (targetSheet.getLastRow() === 0) {
        targetSheet.getRange(1, 1, 1, targetHeadersOrder.length).setValues([targetHeadersOrder]);
      }
      const startRowTarget = targetSheet.getLastRow() + 1;
      const targetRange = targetSheet.getRange(startRowTarget, 1, transformedData.length, targetHeadersOrder.length);
      targetRange.setValues(transformedData);
      
      moveToReportRange.setValues(moveToReportValues);
    }

  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
}
