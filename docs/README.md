# EliteStay Project Structure

The project has been refactored into a modular MVC-style architecture. The single monolithic `server.js` file was split into 11 distinct feature-based route files and 2 utility modules.

---

## Folder Map

```text
boardinghouseforstudent/
│
├── server.js               # Entry point (App Setup, Middleware, Route Mounting)
├── .env                    # Environment variables (DB, Email, PayMongo keys)
│
├── config/
│   └── db.js               # MSSQL Database Connection Pool
│
├── docs/
│   ├── README.md           # This project guide
│   └── SCHEMA.md           # Database Schema Reference
│
├── routes/                 # Express Routers
│   ├── auth.js             # Login, Register, OTP verification, Current User
│   ├── chat.js             # ChatGPT integration for the chatbot AI
│   ├── maintenance.js      # Tenant reporting an issue with a photo
│   ├── profile.js          # Tenant & Admin getting/updating bio and photo
│   ├── payments.js         # Tenant uploading proof of payment manually
│   ├── paymongo.js         # Tenant clicking "Pay with GCash" via PayMongo
│   │
│   └── admin/              # Admin Dashboard Endpoints
│       ├── rooms.js        # CRUD for Rooms and Property Media (Carousel)
│       ├── tenants.js      # CRUD for Tenants, End Lease, Tenant Account Creation
│       ├── payments.js     # View, Approve, Reject tenant payments
│       ├── maintenance.js  # View and Update status of tenant issues
│       └── stats.js        # Financial metrics, Occupancy rate, Manual Reminders
│
├── utils/                  # Reusable Helpers
│   ├── email.js            # Nodemailer transport setup (SMTP config)
│   └── reminders.js        # Automated rent reminder cron job and sending logic
│
└── public/                 # Static Assets (HTML, CSS, JS frontend files)
    ├── uploads/            # Uploaded photos (proofs, profiles, maintenance)
    ├── css/
    ├── js/
    │   ├── admin/
    │   └── tenant/
    └── ...
```

---

## How it Works

### 1. `server.js` (The Hub)
This file is intentionally small (~130 lines). Its only job is to:
1. Connect to the database.
2. Initialize Express, BodyParser, CORS, and Session middleware.
3. Import all `routes/...` and connect them using `app.use()`.
4. Start the app on `PORT 3000`.

### 2. The `routes/` Directory (The Spokes)
Every API endpoint (`/api/...`) lives in the `routes/` folder. They export an `express.Router()` object which hooks back into the main `server.js`.

For example, all requests sent to `/api/admin/rooms` are processed by the logic stored in `routes/admin/rooms.js`.

### 3. Database Access
In any route file where you need to communicate with the DB, you import the global pool promise:
```javascript
const { poolPromise, sql } = require('../config/db');
// usage
const pool = await poolPromise;
const result = await pool.request().query('SELECT * FROM users');
```

---

## Notable Features

### 1. PayMongo Integration (`routes/paymongo.js`)
Handles generating `checkout_url` links for GCash. Converts standard PHP numeric amounts to required integer `centavos`.

### 2. Free Emailing Setup (`utils/email.js`)
Uses `nodemailer` and an `EMAIL_USER` / `EMAIL_PASS` App Password combination to send:
- Login Verification OTPs
- Automated Rent Reminders

### 3. Bot Reminders (`utils/reminders.js`)
A pseudo-cron job runs `scheduleDormRentReminders()`, which wakes up 5 days before the configured `RENT_DUE_DAY` and batches emails to all active tenants reminding them of upcoming rent.
