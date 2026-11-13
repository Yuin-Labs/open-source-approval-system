# Open Source Serverless Approval System
*(Sistem Approval Serverless Open Source)*

A lightweight, serverless approval workflow engine built entirely on Google Workspace (Google Forms, Google Sheets, Google Drive, and Google Apps Script). Designed for multi-tier reimbursement and overlimit approvals (`HR -> L1 Manager -> L2 Manager -> Finance`) with dynamic threshold detection, role-based Web App forms, Super Admin override controls, and automated SLA calculation.

---

## English Documentation

### Key Features
* **Zero Infrastructure:** Runs 100% natively on Google Apps Script, Google Sheets, and Google Drive.
* **Dynamic Schema Mapping:** Maps incoming Google Form responses (`Form Responses 1`) and employee master data (`empdb`) into `Working Sheet` via `Config Working Sheet` rules and dynamic formulas (`{row}`, `{email_col}`).
* **Multi-Tier & Conditional Routing:** Executes sequential approval chains (`HR -> L1 -> L2`) with automatic L2 bypass logic for normal-flow requests or employees without an L2 manager.
* **Overlimit Detection & History Summary:** Compares monthly cumulative usage against employee limits (`Current Usage > Limit`) and embeds a monthly transaction history table directly into L2 approval emails.
* **Interactive Web App Decisions:** Approvers review details and submit mandatory justifications via Google-authenticated Web App forms (`FormReason.html`), with options to **Approve** (including nominal adjustment by HR), **Reject**, or **Hold** (with scheduled reminder dates).
* **Super Admin Override:** Authorized Super Admins (`EMAIL_SUPER_ADMIN`) can intervene at any approval stage with mandatory supporting document uploads stored in Google Drive.
* **Finance Disbursement Portal & SLA Tracking:** Generates a dedicated disbursement form (`FormFinance.html`) for approved requests, attaches proof of transfer, and auto-calculates payment due dates based on submission cut-off times.
* **Automated Archiving:** Transfers completed (`DONE`) records into an external reporting spreadsheet via `Report.gs` based on `Config to Report` mappings.

### Project File Structure
```text
├── Code.gs            # Core engine, triggers, email dispatchers, and Web App controllers
├── button.gs          # Custom Spreadsheet UI menu (onOpen)
├── Report.gs          # Data archiving logic to external reporting spreadsheet
├── FormReason.html    # Web App UI for Approve, Reject, Hold, and Super Admin override
└── FormFinance.html   # Web App UI for Finance transfer receipt upload and SLA logging
```

### Setup Instructions
1. **Prepare Spreadsheets:**
   * Create your main Google Sheet and set up the required tabs: `Working Sheet`, `empdb`, `Config`, `Config Working Sheet`, and `Config to Report`.
   * Create a separate Google Sheet for final reporting/archiving with the target tab (default: `Raw Data Overlimit Reimbursement`).
2. **Link Google Form:**
   * Attach a Google Form to your main spreadsheet (this automatically creates `Form Responses 1`). Ensure it includes a `Status to Working Sheet` column.
3. **Add Apps Script Files:**
   * Open **Extensions > Apps Script** directly from your main spreadsheet (container-bound).
   * Create and paste the contents of `Code.gs`, `button.gs`, `Report.gs`, `FormReason.html`, and `FormFinance.html`.
4. **Configure IDs & Constants:**
   * In `Code.gs`: Update `SPREADSHEET_ID` with your main spreadsheet ID, and `FOLDER_SCREENSHOT_ID` with the target Google Drive folder ID (ID string only, not full URL) for storing Finance and Super Admin attachments.
   * In `Report.gs`: Update `SOURCE_SS_ID` and `TARGET_SS_ID` with your main and archive spreadsheet IDs.
   * In the `Config` sheet: Populate required email keys (`EMAIL_HR`, `EMAIL_FINANCE`, `EMAIL_SUPER_ADMIN`, `CC_ALL_HR_ADMIN`) and column header mappings (`HEADER_*`).
5. **Deploy Web App:**
   * Click **Deploy > New deployment** and select **Web app**.
   * **Execute as:** `Me` (script owner).
   * **Who has access:** `Anyone with Google Account` (required so `Session.getActiveUser().getEmail()` can verify approver identity).
   * Copy the generated Web App URL and paste it into `WEB_APP_URL_RAW` in `Code.gs`, then save.
6. **Set Installable Triggers:**
   * Open **Triggers** (clock icon in the left sidebar) and click **+ Add Trigger**:
     * **Form Submission Trigger:** Function `onFormSubmit` | Event source: `From spreadsheet` | Event type: `On form submit`.
     * **Hold Reminder Trigger (Optional):** Function `cekReminderHold` | Event source: `Time-driven` | Type: `Day timer` (e.g., 8 AM – 9 AM).
   * Reload the spreadsheet to display the custom **Approval System** menu.

---

## Dokumentasi Bahasa Indonesia

### Fitur Utama
* **Tanpa Server (Serverless):** Berjalan 100% menggunakan Google Apps Script, Google Sheets, dan Google Drive.
* **Pemetaan Kolom Dinamis:** Memindahkan respons Google Form (`Form Responses 1`) dan data master karyawan (`empdb`) ke `Working Sheet` secara otomatis berdasarkan aturan dan formula dinamis (`{row}`, `{email_col}`) di `Config Working Sheet`.
* **Alur Persetujuan Bertingkat & Kondisional:** Menjalankan persetujuan berurutan (`HR -> L1 -> L2`) dengan logika *bypass* otomatis pada tahap L2 untuk pengajuan non-overlimit atau karyawan tanpa data L2 Manager.
* **Deteksi Overlimit & Riwayat Bulanan:** Membandingkan akumulasi pemakaian bulan berjalan terhadap batas limit (`Current Usage > Limit`) dan menampilkan tabel riwayat transaksi bulanan karyawan pada email persetujuan L2.
* **Keputusan Interaktif via Web App:** Approver memvalidasi pengajuan dan mengisi catatan/alasan wajib melalui form Web App terautentikasi akun Google (`FormReason.html`), dilengkapi fitur **Approve** (termasuk revisi nominal oleh HR), **Reject**, dan **Hold** (dengan tanggal pengingat otomatis).
* **Super Admin Override:** Akun yang terdaftar pada `EMAIL_SUPER_ADMIN` dapat mengambil alih persetujuan di tahap mana pun dengan wajib mengunggah dokumen bukti pendukung ke Google Drive.
* **Portal Pencairan Finance & Kalkulasi SLA:** Menyediakan form khusus (`FormFinance.html`) untuk tim Finance mengunggah bukti transfer sekaligus menghitung estimasi tanggal pencairan (*Due Date*) otomatis berdasarkan aturan waktu *cut-off*.
* **Pengarsipan Otomatis:** Memindahkan data berstatus `DONE` ke spreadsheet laporan terpisah melalui `Report.gs` sesuai konfigurasi pada sheet `Config to Report`.

### Struktur File Project
```text
├── Code.gs            # Mesin utama, trigger, pengirim email, dan controller Web App
├── button.gs          # Menu kustom di toolbar Google Sheets (onOpen)
├── Report.gs          # Logika pemindahan data selesai ke spreadsheet arsip/laporan
├── FormReason.html    # Antarmuka Web App untuk Approve, Reject, Hold, dan Super Admin
└── FormFinance.html   # Antarmuka Web App untuk upload bukti transfer Finance & SLA
```

### Panduan Instalasi
1. **Siapkan Spreadsheets:**
   * Buat Google Sheet utama dan siapkan tab berikut: `Working Sheet`, `empdb`, `Config`, `Config Working Sheet`, dan `Config to Report`.
   * Buat satu Google Sheet terpisah untuk arsip laporan dengan nama tab target (default: `Raw Data Overlimit Reimbursement`).
2. **Hubungkan Google Form:**
   * Hubungkan Google Form ke spreadsheet utama (otomatis membuat tab `Form Responses 1`). Pastikan terdapat kolom `Status to Working Sheet`.
3. **Tambahkan File Apps Script:**
   * Buka **Ekstensi > Apps Script** langsung dari dalam spreadsheet utama (wajib *container-bound* agar menu UI muncul).
   * Buat dan salin seluruh kode ke dalam 5 file: `Code.gs`, `button.gs`, `Report.gs`, `FormReason.html`, dan `FormFinance.html`.
4. **Konfigurasi ID & Parameter:**
   * Di `Code.gs`: Isi `SPREADSHEET_ID` dengan ID spreadsheet utama, serta `FOLDER_SCREENSHOT_ID` dengan ID folder Google Drive (hanya string ID-nya, bukan URL lengkap) untuk menyimpan lampiran Finance dan Super Admin.
   * Di `Report.gs`: Isi `SOURCE_SS_ID` dengan ID spreadsheet utama dan `TARGET_SS_ID` dengan ID spreadsheet laporan/arsip.
   * Di sheet `Config`: Lengkapi daftar email (`EMAIL_HR`, `EMAIL_FINANCE`, `EMAIL_SUPER_ADMIN`, `CC_ALL_HR_ADMIN`) serta pemetaan nama header kolom (`HEADER_*`).
5. **Deploy Web App:**
   * Klik **Terapkan (Deploy) > Deployment baru**, lalu pilih jenis **Aplikasi web**.
   * **Jalankan sebagai:** `Saya` (pemilik script).
   * **Siapa yang memiliki akses:** `Siapa saja yang memiliki Akun Google` (wajib agar sistem dapat memverifikasi email approver melalui `Session.getActiveUser().getEmail()`).
   * Salin URL Web App yang dihasilkan, tempel ke konstanta `WEB_APP_URL_RAW` di `Code.gs`, lalu simpan.
6. **Atur Pemicu (Installable Triggers):**
   * Buka menu **Pemicu (Triggers)** (ikon jam weker di panel kiri editor) dan klik **+ Tambahkan Pemicu**:
     * **Trigger Form Masuk:** Fungsi `onFormSubmit` | Sumber acara: `Dari spreadsheet` | Jenis acara: `Saat formulir dikirim`.
     * **Trigger Reminder Hold (Opsional):** Fungsi `cekReminderHold` | Sumber acara: `Berdasarkan waktu` | Jenis: `Timer harian` (misalnya pukul 08.00 – 09.00).
   * Muat ulang (refresh) halaman spreadsheet hingga menu **Approval System** muncul di toolbar atas.
