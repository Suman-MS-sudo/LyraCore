# LyraCore — Internal Operations Platform

End-to-end Sales → Production → Dispatch → Installation tracker with role-based access.

---

## 🗂 Project Structure

```
e:\LyraCore\
  backend\      → Express API (Node.js + TypeScript + SQLite)
  frontend\     → React + Vite + Tailwind CSS
  data\         → SQLite database file (auto-created)
  uploads\      → Uploaded files (quotation PDFs, QC photos)
```

---

## 🚀 Quick Start

**Step 1 — Start the backend (port 5000)**
```bash
cd backend
npm run dev        # development (auto-reload)
# or
npm start          # production (after npm run build)
```

**Step 2 — Seed demo users** *(only needed once)*
```bash
cd backend
npm run seed
```

**Step 3 — Start the frontend (port 5173)**
```bash
cd frontend
npm run dev
```

Open → http://localhost:5173

---

## 🔐 Login Credentials (Demo)

| Role       | Email                    | Password   |
|------------|--------------------------|------------|
| CEO        | ceo@lyracore.com         | ceo123     |
| Sales 1    | sales1@lyracore.com      | sales123   |
| Sales 2    | sales2@lyracore.com      | sales123   |
| Production | prod@lyracore.com        | prod123    |

---

## 👤 Role Access Summary

### Sales
- Create/edit leads (own leads only)
- Log follow-ups (call, WhatsApp, email, meeting)
- Upload quotations & proforma invoices
- Confirm payment → triggers production unlock
- Read-only view of dispatch status

### Production
- View all confirmed orders only
- Manage: Fabrication → Assembly → Testing → Dispatch → Installation
- Upload QC photos
- Cannot edit sales data or pricing

### CEO
- Full read-only + analytics across all modules
- Sales funnel, conversion rates, revenue charts
- Production pipeline, delay alerts
- Team performance metrics
- Complete audit log

---

## 🔄 Workflow (End-to-End)

```
Lead Created (Sales)
    ↓
Follow-Up Cycle → NEW → CONTACTED → QUOTATION_SENT → FOLLOW_UP → NEGOTIATION
    ↓
Quotation Uploaded + Payment Confirmed (Sales)
    ↓ [Production unlocked]
Production Order Created
    ↓
Fabrication (Outsourced) → SENT → RECEIVED
    ↓
Assembly → PENDING → IN_PROGRESS → COMPLETED
    ↓
Testing & QC → PASSED / FAILED
    ↓
Packaging → Dispatch (LR number, transporter)
    ↓
Installation → COMPLETED
    ↓
Lead status → CLOSED ✓
```

---

## 📡 API Endpoints

```
POST   /api/auth/login              → Login
GET    /api/auth/me                 → Current user

GET    /api/leads                   → List leads (filtered by role)
POST   /api/leads                   → Create lead
GET    /api/leads/:id               → Lead details + followups + quotations
PATCH  /api/leads/:id               → Update lead / status

GET    /api/followups/due           → Due follow-ups
POST   /api/followups               → Add follow-up
PATCH  /api/followups/:id/complete  → Mark follow-up done

POST   /api/quotations              → Upload quotation
PATCH  /api/quotations/:id/confirm-payment → Confirm payment

GET    /api/production              → List production orders
POST   /api/production              → Create production order
GET    /api/production/:id          → Order details (all stages)
PATCH  /api/production/:id/status   → Update order status
POST   /api/production/:id/fabrication       → Send to fabrication
PATCH  /api/production/:id/fabrication/:fid  → Update fabrication
PATCH  /api/production/:id/assembly          → Update assembly
PATCH  /api/production/:id/testing           → Submit test result
POST   /api/production/:id/testing/qc-photo  → Upload QC photo

POST   /api/dispatch/:orderId              → Create dispatch
PATCH  /api/dispatch/:orderId/dispatch/:id → Update dispatch status

PATCH  /api/installation/:orderId   → Update installation

GET    /api/dashboard/sales         → Sales dashboard data
GET    /api/dashboard/production    → Production dashboard data
GET    /api/dashboard/ceo           → CEO dashboard data

GET    /api/audit                   → Audit logs (CEO only)
```

---

## 🗄 Database Schema

Tables: `users`, `leads`, `followups`, `quotations`, `production_orders`,
`fabrication`, `assembly`, `testing`, `qc_photos`, `dispatch`, `installation`,
`audit_logs`, `counters`

Key auto-numbers: `LEAD-0001`, `PI-0001`, `ORD-0001`

---

## 🛡 Security

- JWT authentication (12h expiry)
- Role-based access on every endpoint
- Sales can only see/edit their own assigned leads
- Full immutable audit log (no deletes, only status changes)

---

## 📦 Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Backend  | Node.js + Express + TypeScript      |
| Database | SQLite via node-sqlite3-wasm (WASM) |
| Auth     | JWT + bcryptjs                      |
| Files    | multer (local disk)                 |
| Frontend | React 18 + Vite + TypeScript        |
| Styling  | Tailwind CSS 3                      |
| Charts   | Recharts                            |
| Routing  | React Router v6                     |

---

## 🔮 Future ERP Enhancements

- [ ] Email/WhatsApp notifications for follow-up reminders
- [ ] Export to Excel/CSV (leads, orders, audit)
- [ ] Multi-product per order
- [ ] Vendor/fabricator portal
- [ ] Invoice generation (PDF)
- [ ] Customer portal for order tracking
- [ ] Mobile app (React Native)
