# Open Source Serverless Approval System 
*(Sistem Approval Serverless Open Source)*

A lightweight, serverless approval workflow engine built entirely on Google Workspace (Google Forms, Sheets, and Apps Script). This system is designed to handle multi-tier approvals (HR -> Manager -> Director -> Finance) with dynamic overlimit detection and one-click email actions.

---

## 🇬🇧 English Documentation

### Features
* **Zero Infrastructure:** Runs 100% on Google Apps Script and Google Sheets.
* **Multi-Tier Routing:** Configurable approval chains (HR -> L1 -> L2).
* **Smart Budget Control:** Automatically routes budget-exceeding requests to higher management.
* **Actionable Emails:** Managers can Approve, Reject, or Hold requests directly via Web App links sent to their email.
* **Finance Disbursement Portal:** Secure UI for Finance to upload transfer receipts.
* **Automated Archiving:** Moves completed data dynamically to a separate reporting spreadsheet.

### Setup Instructions
1. **Prepare Spreadsheets:** Create a Google Sheet and import the provided CSV templates as individual sheets (`Working Sheet`, `empdb`, `Config`, `Config Working Sheet`).
2. **Link Google Form:** Link a Google Form to your spreadsheet (this creates `Form Responses 1`).
3. **Add Apps Script:** Go to `Extensions > Apps Script` and copy the `.gs` and `.html` files from the `src/` folder into the editor.
4. **Deploy Web App:** 
   * Click `Deploy > New Deployment`.
   * Choose `Web app`.
   * Execute as: `Me` (Your email).
   * Who has access: `Anyone with Google Account`.
   * Copy the Web App URL and update the `WEB_APP_URL_RAW` constant in `Main.gs`.
5. **Set Triggers:** Create an installable trigger for `onFormSubmit` to run whenever a new form response is submitted.

---

## 🇮🇩 Dokumentasi Bahasa Indonesia

### Fitur Utama
* **Tanpa Server:** Berjalan 100% menggunakan Google Apps Script dan Google Sheets.
* **Rute Persetujuan Bertingkat:** Alur persetujuan yang dapat dikonfigurasi (HR -> L1 -> L2).
* **Kontrol Anggaran Cerdas:** Otomatis mengarahkan pengajuan yang melebihi batas anggaran ke manajemen yang lebih tinggi.
* **Email Interaktif:** Manajer dapat Menyetujui (Approve), Menolak (Reject), atau Menunda (Hold) pengajuan langsung melalui tautan Web App yang dikirim ke email mereka.
* **Portal Pencairan Finance:** Antarmuka khusus untuk tim Finance mengunggah bukti transfer.
* **Pengarsipan Otomatis:** Memindahkan data yang sudah selesai secara dinamis ke spreadsheet laporan (Raw Data) yang terpisah.

### Panduan Instalasi
1. **Siapkan Spreadsheets:** Buat Google Sheet baru dan impor template CSV yang disediakan sebagai sheet individual (`Working Sheet`, `empdb`, `Config`, `Config Working Sheet`).
2. **Hubungkan Google Form:** Hubungkan Google Form ke spreadsheet Anda (ini akan membuat sheet `Form Responses 1`).
3. **Tambahkan Apps Script:** Buka `Ekstensi > Apps Script` dan salin file `.gs` serta `.html` dari folder `src/` ke dalam editor.
4. **Deploy Web App:** 
   * Klik `Terapkan (Deploy) > Deployment baru`.
   * Pilih `Aplikasi Web`.
   * Jalankan sebagai: `Saya` (Email Anda).
   * Siapa yang memiliki akses: `Siapa saja yang memiliki Akun Google`.
   * Salin URL Web App dan perbarui variabel konstan `WEB_APP_URL_RAW` di dalam `Main.gs`.
5. **Atur Pemicu (Triggers):** Buat trigger terinstal (installable trigger) untuk fungsi `onFormSubmit` agar berjalan setiap kali ada respons form baru yang masuk.
