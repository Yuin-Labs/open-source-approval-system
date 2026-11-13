# Product Requirements Document (PRD)
## Enterprise Reimbursement Approval System (Google Apps Script)

**Versi Dokumen:** 2.0 (Updated to Latest Codebase)  
**Platform:** Google Workspace (Google Forms, Google Sheets, Google Drive, Gmail, Google Apps Script Web App)  
**Target Spreadsheet ID:** `1WVNnlWot_dQJVj8MdvtQLJrtNpomy0kMEsCFfAYl4hc`  

---

## 1. Ringkasan Eksekutif & Tujuan Produk
**Enterprise Reimbursement Approval System** adalah sistem otomasi alur kerja (*workflow automation*) berbasis Google Apps Script (GAS) yang dirancang untuk mengelola pengajuan *reimbursement* (khususnya kasus *overlimit*) secara *end-to-end*. Sistem ini menghubungkan input dari Google Form, memperkaya data karyawan dari database internal, menjalankan persetujuan berjenjang melalui email interaktif dan Web App, menghitung SLA pencairan dana oleh tim Finance, hingga mengarsipkan laporan akhir secara terpusat.

### Tujuan Utama
1. **Otomasi Pemindahan & Pemetaan Data:** Mengeliminasi input manual dengan memindahkan data dari `Form Responses 1` ke `Working Sheet` secara dinamis berdasarkan konfigurasi sheet.
2. **Persetujuan Berjenjang Terkendali:** Menjamin setiap pengajuan melewati validasi berurutan (**HR $\rightarrow$ L1 Manager $\rightarrow$ L2 Manager**) dengan kontrol akses berbasis akun Google dan *concurrency lock* (`LockService`).
3. **Transparansi & Audit Trail:** Mencatat seluruh riwayat keputusan, alasan, waktu persetujuan, lampiran bukti, serta mengirim notifikasi status otomatis kepada pemohon (*requester*) dan tim Finance.

---

## 2. Arsitektur Sistem & Struktur Data

### 2.1 Komponen Kode (Google Apps Script)
| Nama File | Peran & Tanggung Jawab |
| :--- | :--- |
| `Code.gs` | *Core engine*: Manajemen koneksi spreadsheet (`getSS()`), *caching* konfigurasi (`getConfig()`), *mapping* data form ke working sheet, mesin *state-machine* approval (`processRow`), pengiriman email HTML, serta controller Web App (`doGet`, `executeApprovalFromWeb`, `executeFinanceFormSubmission`). |
| `button.gs` | Antarmuka pengguna di Google Sheets (`onOpen()`) yang menyediakan menu kustom **Approval System** untuk sinkronisasi manual, pengecekan status *hold*, kirim ulang email penolakan, dan ekspor laporan. |
| `Report.gs` | Modul pengarsipan (`moveWorkingDataToRawData()`) untuk memindahkan baris berstatus `DONE` ke spreadsheet arsip eksternal berdasarkan pemetaan di `Config to Report`. |
| `FormReason.html` | Antarmuka Web App bagi approver (HR, L1, L2, Super Admin) untuk menginput alasan keputusan, mengubah nominal (khusus HR), mengatur jadwal *reminder* (khusus *Hold*), dan mengunggah bukti pendukung (khusus Super Admin). |
| `FormFinance.html` | Antarmuka Web App bagi tim Finance untuk meninjau detail rekening karyawan, melihat log approval, serta mengunggah bukti transfer (*disbursement*). |

### 2.2 Struktur Sheet dalam Spreadsheet Utama
1. **`Form Responses 1`**: Penampung hasil submit Google Form. Memiliki kolom kontrol `Status to Working Sheet` untuk mencegah duplikasi pemindahan data.
2. **`Working Sheet`**: Lembar kerja utama tempat seluruh siklus hidup pengajuan diproses dan dipantau.
3. **`empdb`**: Database induk karyawan untuk *lookup* otomatis profil karyawan berdasarkan alamat email pemohon.
4. **`Config`**: Tabel *Key-Value* (Kolom A = Key, Kolom B/C = Value) yang menyimpan parameter dinamis seperti nama header kolom, email penerima (`EMAIL_HR`, `EMAIL_FINANCE`, `EMAIL_SUPER_ADMIN`), dan daftar CC.
5. **`Config Working Sheet`**: Tabel aturan pemetaan kolom dari sumber (`form responses 1`, `empdb`, atau formula dinamis dengan placeholder `{row}` dan `{email_col}`) menuju `Working Sheet`.
6. **`Config to Report`**: Tabel aturan pemetaan header dari `Working Sheet` menuju spreadsheet arsip laporan.

---

## 3. Alur Kerja Utama (Functional Requirements)

### 3.1 Tahap 1: Ingesti & Pemetaan Data (`onFormSubmit` & `moveResponseToWorkingSheet`)
* **Pemicu Otomatis:** Ketika formulir disubmit, trigger `onFormSubmit(e)` memanggil `moveResponseToWorkingSheet(row, true)`.
* **Pemicu Manual:** Melalui menu **Approval System > Sync Manual (Pending Rows)** (`runManualForAllPending()`), sistem memindai seluruh baris di `Form Responses 1` yang kolom `Status to Working Sheet`-nya belum bernilai `DONE` (melewati baris kosong menggunakan `continue`), memindahkannya, lalu menjalankan `processRow()` pada baris yang belum selesai di `Working Sheet`.
* **Logika Pemetaan:**
  * Mencocokkan `Email Address` pemohon dengan data di sheet `empdb`. Jika tidak ditemukan, kolom terkait diisi `"Not Found"`.
  * Menyalin kolom dari `Form Responses 1`, `empdb`, atau menyisipkan formula spreadsheet sesuai konfigurasi di `Config Working Sheet`.
  * Menandai kolom `Status to Working Sheet` menjadi `DONE` dan mengeksekusi `processRow(targetRow)`.

### 3.2 Tahap 2: Mesin Persetujuan Berjenjang (`processRow` & `_processRowInternal`)
Sistem mengevaluasi status setiap baris secara berurutan dengan perlindungan `LockService` (timeout 20 detik) untuk mencegah *race condition*:

1. **Level 1 — Verifikasi Awal HR (`HR`)**
   * **Kondisi:** Kolom status HR kosong atau diawali `"EMAIL FAILED"`.
   * **Aksi:** Mengirim email persetujuan ke `EMAIL_HR` (dengan lampiran file dari Google Drive jika ada) dan mengubah status HR menjadi `"SENT TO HR"`. Jika gagal, mencatat pesan error `"EMAIL FAILED: <pesan>"`.
   * **Opsi Keputusan HR:**
     * `APPROVE`: HR dapat mengedit nominal `Total Pengajuan` melalui form Web App sebelum menyetujui. Alur lanjut ke **L1**.
     * `REJECT`: Status utama menjadi `REJECTED`, sistem mengirim email penolakan ke pemohon.
     * `HOLD`: HR menentukan tanggal & jam *reminder*. Status utama menjadi `HOLD`. Sistem dapat memeriksa jatuh tempo secara berkala via fungsi `cekReminderHold()`.

2. **Level 2 — Persetujuan Atasan Langsung (`L1 Manager`)**
   * **Kondisi:** Status HR adalah `APPROVE` (atau disetujui Super Admin) dan status L1 masih kosong serta belum tercatat di `L1 Email Sent At`.
   * **Aksi:** Mengirim email persetujuan ke `Email Manager` (CC `CC_ALL_HR_ADMIN`) dan mencatat waktu pengiriman.
   * **Opsi Keputusan L1:** `APPROVE` (lanjut ke L2) atau `REJECT` (berhenti & kirim email penolakan).

3. **Level 3 — Validasi Akhir Manajemen (`L2 Manager`)**
   * **Kondisi:** HR dan L1 telah menyetujui, dan status L2 masih kosong.
   * **Aturan *Bypass* Otomatis:**
     * Jika perusahaan termasuk alur normal (`company.includes("company a")`) **DAN** tidak melebihi limit (`Current Usage <= Limit`), sistem otomatis mengisi status L2 dengan `"BYPASSED (Normal Flow)"`.
     * Jika kolom `L2 Manager` kosong atau bernilai `"-"`, sistem otomatis mengisi status L2 dengan `"BYPASSED (No L2 Data)"`.
   * **Aturan *Overlimit* (`Current Usage > Limit`):**
     * Jika pengajuan melebihi limit toleransi, sistem mengirimkan email khusus dengan subjek `[OVERLIMIT DETECTED]` yang menyertakan tabel riwayat akumulasi pengajuan karyawan pada bulan berjalan (`_getEmployeeHistoryTableHtml`), serta men-CC L1 Manager dan HR Admin.

4. **Level 4 — Penyelesaian & Notifikasi Akhir (`checkFinalStatus`)**
   * **Kondisi:** HR, L1, dan L2 seluruhnya berstatus `APPROVE`, `BYPASSED`, atau `SUPPORT SUPER ADMIN`.
   * **Aksi:**
     * Mengubah kolom `Status` utama menjadi `DONE`.
     * Mengirim email pemberitahuan persetujuan penuh kepada karyawan pemohon (`sendRequesterDoneEmail`).
     * Mengirim email perintah pencairan dana (*Disbursement*) berisi tautan `FormFinance.html` ke `EMAIL_HR` (`sendHRFinanceFormEmail`).

### 3.3 Tahap 3: Proses Disbursement Finance (`executeFinanceFormSubmission`)
* **Input:** Petugas membuka tautan `action=finance_form`, memverifikasi detail rekening bank karyawan dan log persetujuan manajemen, lalu mengunggah bukti transfer (Gambar/PDF).
* **Penyimpanan & Lampiran:** Bukti transfer disimpan ke folder Google Drive (`FOLDER_SCREENSHOT_ID`), URL-nya dicatat di kolom `Lampiran ke Finance`, dan file-nya digabungkan bersama lampiran pendukung awal karyawan untuk dikirim ke `EMAIL_FINANCE`.
* **Perhitungan Otomatis Due Date (SLA Finance):**
  * Sistem menghitung estimasi tanggal pencairan berdasarkan hari dan jam *submit* form Finance:
    * **Kamis ($\ge$ 16:00) s/d Senin ($<$ 16:00):** Ditambah 3–7 hari kalender (jatuh pada hari Kamis berikutnya).
    * **Senin ($\ge$ 16:00) s/d Kamis ($<$ 16:00):** Ditambah 5–8 hari kalender (jatuh pada hari Selasa berikutnya).
  * Hasilnya dicatat pada kolom `Due Date Finance` dan ditampilkan di dalam badan email Finance.
* **Finalisasi:** Kolom `Sent to Finance` ditandai `DONE` untuk mencegah pengiriman ganda.

### 3.4 Tahap 4: Pengarsipan Laporan (`moveWorkingDataToRawData`)
* Dijalankan melalui menu **Approval System > Move to Data Report**.
* Memfilter baris di `Working Sheet` yang memiliki `Status === "DONE"` dan `Move to report !== "DONE"`.
* Memetakan kolom sesuai konfigurasi `Config to Report`, menyalin data ke spreadsheet arsip eksternal (`TARGET_SS_ID`), dan menandai kolom `Move to report` menjadi `DONE`.

---

## 4. Keamanan, Hak Akses & Fitur Administratif

### 4.1 Autentikasi & Otorisasi Web App (`doGet`)
* **Login Bridge:** Seluruh tautan di email dibungkus menggunakan `https://accounts.google.com/AccountChooser?continue=...` untuk memastikan pengguna masuk dengan akun Google yang tepat.
* **Validasi Urutan:** Sistem menolak akses jika L1 mencoba membuka tautan sebelum HR menyetujui, atau L2 membuka tautan sebelum L1 menyetujui.
* **Validasi Identitas:** `Session.getActiveUser().getEmail()` dicocokkan dengan email yang berwenang pada level terkait (`EMAIL_HR`, `Email Manager`, atau `L2 Email Manager`). Jika tidak cocok, akses ditolak.
* **Idempotensi:** Keputusan yang sudah tersimpan (`APPROVE`, `REJECT`, atau `BYPASSED`) terkunci dan tidak dapat diubah ulang melalui tautan yang sama.

### 4.2 Hak Istimewa Super Admin (`EMAIL_SUPER_ADMIN`)
* Akun yang terdaftar pada `EMAIL_SUPER_ADMIN` dapat mengambil alih (*override*) persetujuan atau penolakan di level manapun (HR, L1, maupun L2).
* Saat menyetujui/menolak sebagai Super Admin, form mewajibkan unggahan dokumen bukti pendukung (PDF/JPG/PNG) yang otomatis disimpan ke Google Drive dan ditautkan sebagai `=HYPERLINK("...", "Support by Super Admin")` pada kolom pencatat approver, dengan status tercatat sebagai `APPROVE - SUPPORT SUPER ADMIN` atau `REJECTED - SUPPORT SUPER ADMIN`.

### 4.3 Menu Kontrol UI Spreadsheet (`button.gs`)
Menu **Approval System** muncul otomatis saat spreadsheet dibuka (`onOpen()`) berkat inisialisasi *lazy-load* `getSS()` yang kompatibel dengan *simple trigger*:
1. **Sync Manual (Pending Rows):** Memproses antrean form yang belum masuk ke `Working Sheet` dan melanjutkan baris yang tertunda.
2. **Check Hold Status:** Memeriksa baris berstatus `HOLD` yang telah mencapai tanggal *reminder* untuk dikirim ulang email verifikasinya ke HR.
3. **Resent Email Rejection:** Memunculkan *prompt* input nomor baris untuk mengirim ulang email penolakan ke karyawan.
4. **Move to Data Report:** Mengekspor data selesai (`DONE`) ke spreadsheet arsip laporan.

---

## 5. Konfigurasi & Prasyarat Deployment

Agar sistem beroperasi tanpa kendala pada lingkungan produksi, pastikan parameter berikut terpenuhi:

| Parameter / Komponen | Lokasi | Ketentuan Wajib |
| :--- | :--- | :--- |
| **Container-Bound Script** | Extensions > Apps Script | Script harus terikat langsung pada Spreadsheet ID `1WVNnlWot_dQJVj8MdvtQLJrtNpomy0kMEsCFfAYl4hc` agar menu `onOpen()` tampil. |
| **Installable Trigger** | Apps Script > Triggers | Wajib mendaftarkan trigger `onFormSubmit` dengan event source **From spreadsheet** dan event type **On form submit**. |
| **Web App Deployment** | Deploy > Manage deployments | Execute as: **User accessing the web app** (agar `Session.getActiveUser().getEmail()` terbaca) atau sesuai kebijakan domain Google Workspace internal; Who has access: **Anyone within [Organization] / Anyone with Google Account**. |
| **Folder ID Drive** | `Code.gs` (`FOLDER_SCREENSHOT_ID`) | Menggunakan ID folder murni (`1E8aoEh-FxgwHdZHL-pn7FRBtpo-j28nn`), bukan URL lengkap, dengan izin tulis (*Editor*) bagi pengguna yang menjalankan Web App. |
| **Target Archive ID** | `Report.gs` (`TARGET_SS_ID`) | Wajib diisi dengan ID Spreadsheet arsip tujuan sebelum menjalankan menu **Move to Data Report**. |
| **Email Alias Sender** | `Code.gs` (`getEmailAliasConfig`) | Jika menggunakan pengiriman atas nama alias (`admin@companya.com` / `admin@companyb.com`), alamat alias tersebut harus sudah terdaftar dan terverifikasi pada fitur *Send mail as* di akun Gmail pengirim. |