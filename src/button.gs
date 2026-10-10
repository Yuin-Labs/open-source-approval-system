// ─────────────────────────────────────────────────────────────────────────────
// MENU & TRIGGER UTAMA
// ─────────────────────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('SISTEM APPROVAL')
    .addItem('Sync Manual (Pending Rows)', 'runManualForAllPending')
    .addItem('Cek Hold Status', 'cekReminderHold')
    .addItem('Resent Email Rejection', 'resendRejectEmailViaPrompt')
    .addSeparator()
    .addItem('Pindah Data Report', 'moveWorkingDataToRawData')
    .addToUi();
}
