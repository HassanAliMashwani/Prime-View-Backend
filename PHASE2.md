# Phase 2 Implementation Summary: Prime View Society Management

## 1. What Phase 2 Shipped
- **P2-01 (Concurrency & Mutation Locks):** Row-level lock acquisition (`FOR UPDATE`), optimistic versioning, and race prevention on plot mutations.
- **P2-02 (Reservation Lifecycle & Sweeps):** Standardized 24-hour reservation hold window, supersede handling, and cron-based expiry sweeps.
- **P2-03 (Customer Lifecycle & Suspensions):** Full customer CRUD, profile synchronization, account suspension guards, and dispute flagging.
- **P2-04 (Public Verification & Dual QR Slips):** Public tokenless slip verification (`/verify/:slipNumber`) and immutable A4 bank payment receipts with verify QR links.
- **P2-05 (Financial Ledgers & Balloon Engine):** Integer PKR ledger math, dynamic installment preview calculation, and non-overwriting payment allocation records.
- **P2-06 (Supabase Storage Integration):** Private storage bucket integration with time-limited signed URLs for customer identity and payment documents.
- **P2-07 (Row-Level Security Enforcement):** Database-level Postgres RLS policies isolated via session context (`app.current_role` / `app.current_customer_id`).
- **P2-08 (Module Registry & Permission Scopes):** 10 granular permission flags across administrative modules with JWT claims propagation.
- **P2-09 (Admin Portal Navigation Polish):** Removal of legacy demo credentials from login, mobile navigation drawer, and session-driven sidebar links.
- **P2-10 (Teams Grid & Sub-Admin Isolation):** Responsive card grid for sub-administrator management with Super Admin guard enforcement (`403 Forbidden` for sub-admins).

---

## 2. Running Locally

### Backend (NestJS + Prisma)
```bash
cd "Prime view backend"
npm install
# Set DIRECT_URL, DATABASE_URL, and JWT_SECRET in .env
npm run start:dev
# Running on http://localhost:3001
```

### Frontend (Next.js)
```bash
cd "Prime View frontend"
npm install
# Ensure NEXT_PUBLIC_API_URL=http://localhost:3001 in .env.local
npm run dev
# Running on http://localhost:3000
```

---

## 3. Allocation Rule (D2)
- **Allotted:** Plot status `allotted` is assigned **strictly** upon upfront full payment (`paymentType: 'one_time'`).
- **Booked:** Installment bookings remain in `booked` status throughout the installment lifecycle until final maturity and verification.

---

## 4. Open Items (Intentionally Open)
- **OI-12 (A-01 Duplicate Bookings):** Plot `plot-a-01` contains dual completed one-time bookings (`book-1789346204123-dlee` and `book-1789346207463-c7bj`). Retained as OPEN for administrative adjudication; neither record was deleted or prioritized.
- **OI-13 (Elite Historical Booked Plots Without Owner):** Elite plots `plot-el-34`, `plot-el-94`, `plot-el-128`, `plot-el-147`, and `plot-el-254` remain in `booked` status without assigned `currentOwnerId`. Retained as OPEN pending documentation verification.
