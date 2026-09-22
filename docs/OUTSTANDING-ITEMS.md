# Prime View — Outstanding Items Ledger

### [OI-12] Plot A-01 Dual Booking Dispute & Ownership Resolution
- **What was found:** Plot `plot-a-01` (Abbott Block, Plot A-01) has two active bookings in the database:
  1. `book-1789332219468-0z6y` (Customer `cust-danish-ali`, booked 2026-09-10T18:03:39.468Z, 1 payment record PKR 24,000,000 paid)
  2. `book-1789345091771-3q04` (Customer `cust-imran-khan`, booked 2026-09-10T21:38:11.771Z, 1 payment record PKR 24,000,000 paid)
- **Current state:** Plot status was set to `disputed` in P2-01. Both bookings remain active in the database.
- **What is needed to close:** Formal management decision and manual resolution to cancel/reallocate one booking and assign single definitive ownership.
- **Status:** OPEN.

---

### [OI-13] Five Extra Seeded Plots in Booked Status Without Bookings
- **What was found:** 5 plots in Elite Block have `status: 'booked'` and `currentOwnerId: null` with 0 associated `Booking` records:
  - `plot-el-128` (Plot 128)
  - `plot-el-147` (Plot 147)
  - `plot-el-254` (Plot 254)
  - `plot-el-34` (Plot 34)
  - `plot-el-94` (Plot 94)
- **Current state:** Preserved as-is (read-only) per P2-02 requirements. No manual status mutations performed.
- **What is needed to close:** Confirm whether these plots should be released to `available` or if legacy offline booking records need to be backfilled.
- **Status:** OPEN.
