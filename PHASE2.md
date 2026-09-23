# Phase 2 Implementation Summary: Prime View Society Management

## 1. What Phase 2 Shipped
- **P2-01:** Map colours — Allotted + Allotted+Disputed. No 5th inventory column.
- **P2-02:** Reservation hold is 24 hours + sweep expiry.
- **P2-03:** Suspended owner derives Disputed on the map (stored `disputed` still wins).
- **P2-04:** Inventory 4 columns (Available / Reserved / Booked / Allotted) + PlotStatusHistory. Disputed is a footnote.
- **P2-05:** Installment number locked on submit (server ignores client number).
- **P2-06:** Balloon payments — allocate waterfall, never overwrite `PaymentRecord.amount`, 409 PREVIEW_DRIFT vs 422 BALLOON_ERROR.
- **P2-07:** QR on both slip halves, URL-only `/verify/{slipNumber}`, public verify without fake `super_admin`.
- **P2-08:** MODULE_REGISTRY (10 keys), D8 backfill, kill `withScopedSession({ role: 'super_admin' })`.
- **P2-09:** Drawer keyed by registry; remove one-click `password123` logins and header role switcher.
- **P2-10:** Teams card grid; all 10 permission toggles; sub-admin list/create is 403.

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
- **Allotted:** only `paymentType: one_time` (full upfront). That is paid-in-full.
- **Booked:** installment stays `booked` after the last installment. It never flips to allotted.

---

## 4. Open Items (Intentionally Open)
- **OI-12 (A-01 Duplicate Bookings):** Plot `plot-a-01` contains dual completed one-time bookings (`book-1789346204123-dlee` and `book-1789346207463-c7bj`). Retained as OPEN for administrative adjudication; neither record was deleted or prioritized.
- **OI-13 (Elite Historical Booked Plots Without Owner):** Elite plots `plot-el-34`, `plot-el-94`, `plot-el-128`, `plot-el-147`, and `plot-el-254` remain in `booked` status without assigned `currentOwnerId`. Retained as OPEN pending documentation verification.
