# Product Requirements Document (PRD)
## Enterprise Reimbursement Approval System (Google Apps Script)

**Document Version:** 2.0 (Aligned with Latest Codebase)  
**Platform:** Google Workspace (Google Forms, Google Sheets, Google Drive, Gmail, Google Apps Script Web App)  
**Target Spreadsheet ID:** `1WVNnlWot_dQJVj8MdvtQLJrtNpomy0kMEsCFfAYl4hc`  

---

## 1. Executive Summary & Product Objectives
The **Enterprise Reimbursement Approval System** is an end-to-end workflow automation solution built on Google Apps Script (GAS) designed to manage reimbursement requests (specifically overlimit claims). The system seamlessly connects Google Form submissions, enriches employee profile data from an internal master database, orchestrates multi-tier approvals via interactive HTML emails and a Web App, calculates Finance disbursement SLAs, and archives finalized records into a centralized reporting spreadsheet.

### Core Objectives
1. **Automated Data Ingestion & Mapping:** Eliminate manual data entry by dynamically transferring and mapping submissions from `Form Responses 1` to the `Working Sheet` based on configurable rules.
2. **Controlled Multi-Tier Approval Workflow:** Enforce strict sequential approvals (**HR $\rightarrow$ L1 Manager $\rightarrow$ L2 Manager**) backed by Google Account identity verification and concurrency locks (`LockService`).
3. **Full Transparency & Audit Trail:** Log every approval decision, justification, timestamp, and supporting attachment, while dispatching automated status notifications to requesters and the Finance team.

---

## 2. System Architecture & Data Structure

### 2.1 Codebase Components (Google Apps Script)
| File Name | Role & Responsibilities |
| :--- | :--- |
| `Code.gs` | **Core Engine:** Handles lazy-loaded spreadsheet connections (`getSS()`), configuration caching (`getConfig()`), dynamic form-to-working-sheet data mapping, state-machine approval processing (`processRow`), HTML email notifications, and Web App controllers (`doGet`, `executeApprovalFromWeb`, `executeFinanceFormSubmission`). |
| `button.gs` | **Spreadsheet UI Menu (`onOpen()`):** Renders the custom **Approval System** menu in Google Sheets for manual synchronization, hold-status reminders, rejection email resends, and report archiving. |
| `Report.gs` | **Archiving Module (`moveWorkingDataToRawData()`):** Transfers `DONE` records from the `Working Sheet` to an external archive spreadsheet using the mapping rules defined in `Config to Report`. |
| `FormReason.html` | **Approver Web UI:** Web App interface allowing approvers (HR, L1, L2, Super Admin) to submit decision justifications, adjust claim amounts (HR only), schedule hold reminders (HR Hold only), and upload supporting documents (Super Admin override). |
| `FormFinance.html` | **Finance Disbursement Web UI:** Web App interface enabling Finance personnel to review employee bank account details, audit approval logs, and upload transfer receipts. |

### 2.2 Master Spreadsheet Structure
1. **`Form Responses 1`**: Raw repository for Google Form submissions. Contains the `Status to Working Sheet` control column to prevent duplicate processing.
2. **`Working Sheet`**: Operational workspace where the entire approval lifecycle, status tracking, and SLA calculations are managed.
3. **`empdb`**: Employee master database used to automatically look up employee details using the submitter's email address.
4. **`Config`**: Key-Value configuration table (Column A = Key, Column B/C = Value) storing dynamic header mappings, recipient emails (`EMAIL_HR`, `EMAIL_FINANCE`, `EMAIL_SUPER_ADMIN`), and CC lists.
5. **`Config Working Sheet`**: Column mapping configuration defining how data is populated into the `Working Sheet` from `form responses 1`, `empdb`, or dynamic spreadsheet formulas (supporting `{row}` and `{email_col}` placeholders).
6. **`Config to Report`**: Header mapping rules governing data export from the `Working Sheet` to the external reporting archive.

---

## 3. Core Workflows (Functional Requirements)

### 3.1 Stage 1: Data Ingestion & Mapping (`onFormSubmit` & `moveResponseToWorkingSheet`)
* **Automated Trigger:** Upon form submission, the installable trigger `onFormSubmit(e)` invokes `moveResponseToWorkingSheet(row, true)`.
* **Manual Fallback:** Triggered via **Approval System > Sync Manual (Pending Rows)** (`runManualForAllPending()`), which scans `Form Responses 1` for rows where `Status to Working Sheet` is not `DONE` (safely skipping blank rows via `continue`), migrates them, and invokes `processRow()` for any incomplete rows in the `Working Sheet`.
* **Mapping Logic:**
  * Matches the submitter's `Email Address` against `empdb`. If no match is found, mapped employee fields default to `"Not Found"`.
  * Populates target columns from `Form Responses 1`, `empdb`, or injects dynamic formulas as defined in `Config Working Sheet`.
  * Marks `Status to Working Sheet` as `DONE` and triggers `processRow(targetRow)`.

### 3.2 Stage 2: Multi-Tier Approval State Machine (`processRow` & `_processRowInternal`)
Each row is evaluated sequentially under a `LockService` mutex (20-second timeout) to prevent race conditions:

1. **Tier 1 — Initial HR Verification (`HR`)**
   * **Condition:** HR status column is empty or starts with `"EMAIL FAILED"`.
   * **Action:** Sends an approval email to `EMAIL_HR` (attaching Google Drive files if present) and sets HR status to `"SENT TO HR"`. On failure, logs `"EMAIL FAILED: <error_message>"`.
   * **HR Decision Options:**
     * `APPROVE`: HR may optionally edit the `Total Pengajuan` (Claim Amount) in the Web App prior to approving. Advances workflow to **L1**.
     * `REJECT`: Sets main `Status` to `REJECTED` and sends a rejection email to the requester.
     * `HOLD`: HR sets a reminder date/time. Sets main `Status` to `HOLD`. Due reminders are evaluated via `cekReminderHold()`.

2. **Tier 2 — Direct Manager Approval (`L1 Manager`)**
   * **Condition:** HR status is `APPROVE` (or Super Admin override), L1 status is empty, and `L1 Email Sent At` is blank.
   * **Action:** Dispatches an approval email to `Email Manager` (CC `CC_ALL_HR_ADMIN`) and records the timestamp.
   * **L1 Decision Options:** `APPROVE` (advances to L2) or `REJECT` (halts workflow and sends rejection notification).

3. **Tier 3 — Final Management Validation (`L2 Manager`)**
   * **Condition:** Both HR and L1 have approved, and L2 status is empty.
   * **Automated Bypass Rules:**
     * If the entity follows the standard flow (`company.includes("company a")`) **AND** the claim does not exceed the limit (`Current Usage <= Limit`), L2 is automatically marked `"BYPASSED (Normal Flow)"`.
     * If the `L2 Manager` field is blank or `"-"`, L2 is automatically marked `"BYPASSED (No L2 Data)"`.
   * **Overlimit Rule (`Current Usage > Limit`):**
     * If the claim exceeds the tolerance limit, the system dispatches a `[OVERLIMIT DETECTED]` email containing an HTML summary table of the employee's cumulative claims for the current month (`_getEmployeeHistoryTableHtml`), with L1 Manager and HR Admin copied (`CC`).

4. **Tier 4 — Completion & Final Notifications (`checkFinalStatus`)**
   * **Condition:** HR, L1, and L2 all hold `APPROVE`, `BYPASSED`, or `SUPPORT SUPER ADMIN` statuses.
   * **Action:**
     * Updates the primary `Status` column to `DONE`.
     * Sends a final approval confirmation email to the employee (`sendRequesterDoneEmail`).
     * Sends a disbursement action email containing the `FormFinance.html` link to `EMAIL_HR` (`sendHRFinanceFormEmail`).

### 3.3 Stage 3: Finance Disbursement Processing (`executeFinanceFormSubmission`)
* **Input:** Finance personnel open the `action=finance_form` link, verify bank details and management approval logs, and upload a transfer receipt (Image/PDF).
* **Storage & Attachments:** Uploads the receipt to Google Drive (`FOLDER_SCREENSHOT_ID`), logs the file URL in `Lampiran ke Finance`, bundles it with the employee's original supporting attachments, and emails `EMAIL_FINANCE`.
* **Automated Finance SLA Due Date Calculation:**
  * Calculates the estimated disbursement date based on the submission day and hour:
    * **Thursday ($\ge$ 16:00) through Monday ($<$ 16:00):** Adds 3–7 calendar days (targeting the following Thursday).
    * **Monday ($\ge$ 16:00) through Thursday ($<$ 16:00):** Adds 5–8 calendar days (targeting the following Tuesday).
  * Writes the calculated date to `Due Date Finance` and highlights it inside the Finance notification email.
* **Finalization:** Sets `Sent to Finance` to `DONE` to prevent duplicate submissions.

### 3.4 Stage 4: Report Archiving (`moveWorkingDataToRawData`)
* Executed manually via **Approval System > Move to Data Report**.
* Filters rows in the `Working Sheet` where `Status === "DONE"` and `Move to report !== "DONE"`.
* Maps fields according to `Config to Report`, appends the rows to the external archive spreadsheet (`TARGET_SS_ID`), and marks `Move to report` as `DONE`.

---

## 4. Security, Access Control & Administrative Features

### 4.1 Web App Authentication & Authorization (`doGet`)
* **Google Account Chooser Bridge:** All email action links are wrapped in `https://accounts.google.com/AccountChooser?continue=...` to ensure users authenticate with the intended Google account.
* **Sequential Enforcement:** Blocks L1 access if HR has not approved, and blocks L2 access if L1 has not approved.
* **Identity Verification:** Compares `Session.getActiveUser().getEmail()` against the authorized email for the requested tier (`EMAIL_HR`, `Email Manager`, or `L2 Email Manager`), rejecting unauthorized users.
* **Idempotency:** Once a tier is marked `APPROVE`, `REJECT`, or `BYPASSED`, the decision is locked and cannot be altered via replay links.

### 4.2 Super Admin Override (`EMAIL_SUPER_ADMIN`)
* Users listed in `EMAIL_SUPER_ADMIN` can override approvals or rejections at any tier (HR, L1, or L2).
* When acting as a Super Admin, the Web App mandates uploading supporting evidence (PDF/JPG/PNG), which is stored in Google Drive and recorded as `=HYPERLINK("...", "Support by Super Admin")` in the approver column, logging the status as `APPROVE - SUPPORT SUPER ADMIN` or `REJECTED - SUPPORT SUPER ADMIN`.

### 4.3 Custom Spreadsheet UI Menu (`button.gs`)
The **Approval System** menu loads automatically when opening the spreadsheet (`onOpen()`), enabled by the lazy-loaded `getSS()` helper compatible with simple triggers:
1. **Sync Manual (Pending Rows):** Processes unmigrated form responses and advances stalled rows in the `Working Sheet`.
2. **Check Hold Status:** Scans `HOLD` rows whose reminder date has arrived and re-dispatches verification emails to HR.
3. **Resent Email Rejection:** Prompts for a specific row number to resend a rejection notification email to the employee.
4. **Move to Data Report:** Exports finalized (`DONE`) records to the external reporting archive.

---

## 5. Configuration & Deployment Prerequisites

To ensure uninterrupted operation in production, verify the following deployment requirements:

| Parameter / Component | Location | Mandatory Requirement |
| :--- | :--- | :--- |
| **Container-Bound Script** | Extensions > Apps Script | The script project must be bound directly to Spreadsheet ID `1WVNnlWot_dQJVj8MdvtQLJrtNpomy0kMEsCFfAYl4hc` for the `onOpen()` menu to render. |
| **Installable Trigger** | Apps Script > Triggers | Must register an installable trigger for `onFormSubmit` with event source **From spreadsheet** and event type **On form submit**. |
| **Web App Deployment** | Deploy > Manage deployments | Set **Execute as** to capture user identity (`Session.getActiveUser().getEmail()`) per workspace policy, and **Who has access** to your organization domain or Google Accounts. |
| **Google Drive Folder ID** | `Code.gs` (`FOLDER_SCREENSHOT_ID`) | Must contain only the raw Folder ID (`1E8aoEh-FxgwHdZHL-pn7FRBtpo-j28nn`), not the full URL, with Editor permissions granted to Web App users. |
| **Archive Spreadsheet ID** | `Report.gs` (`TARGET_SS_ID`) | Must be populated with the destination archive Spreadsheet ID before running **Move to Data Report**. |
| **Email Alias Configuration** | `Code.gs` (`getEmailAliasConfig`) | Any custom sender alias (`admin@companya.com` / `admin@companyb.com`) must be registered and verified under Gmail's **Send mail as** settings on the executing account. |