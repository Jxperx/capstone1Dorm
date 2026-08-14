# Automated Email Trigger Logic Flow

This document details the logic for the automated email notifications using Nodemailer.

## 1. Monthly Billing Invoices (Cron Job)
**Goal**: Send an invoice email to all active tenants on a specific day of the month (e.g., the 1st or 25th).

**Logic Flow**:
1.  **Trigger**: A scheduled Cron job (using `node-cron` or system cron) runs daily at 00:00.
2.  **Check Date**: If `Current Date == Billing Date` (e.g., 1st of Month):
3.  **Fetch Data**: Query database for all `Tenants` with `status = 'active'`.
4.  **Loop**: For each tenant:
    *   Calculate `Total Due` (Room Rate + any pending dues).
    *   **Action**: Generate Email Content (HTML Template) with Invoice details.
    *   **Send**: Call `sendMail(tenant_email, "Monthly Invoice", html_content)`.
5.  **Log**: Record that invoices were generated/sent.

## 2. Digital Receipts (Event Trigger)
**Goal**: Email a PDF receipt when Admin approves a payment.

**Logic Flow**:
1.  **Trigger**: Admin clicks "Approve" button on the Payment Dashboard.
2.  **Server Action**:
    *   Update `payments` table: Set `status = 'approved'`.
    *   Fetch `User` (Tenant) and `Payment` details.
3.  **PDF Generation**:
    *   Use a library (e.g., `pdfkit` or `puppeteer`) to generate a PDF receipt containing: Transaction ID, Date, Amount, Tenant Name, Room Number.
4.  **Send Email**:
    *   Create email with subject "Payment Receipt - Approved".
    *   Attach the generated PDF.
    *   Call `sendMail(tenant_email, ..., attachment)`.

## 3. Maintenance Alerts (Event Trigger)
**Goal**: Notify tenant when their issue is resolved.

**Logic Flow**:
1.  **Trigger**: Admin updates a Maintenance Request status to 'Resolved'.
2.  **Server Action**:
    *   Update `maintenance_requests` table: Set `status = 'resolved'`, `resolved_at = NOW()`.
    *   Fetch `Tenant` contact info.
3.  **Send Email**:
    *   Subject: "Maintenance Request Resolved - [Ticket ID]".
    *   Body: "Dear [Name], your request regarding [Issue Title] has been marked as resolved."
