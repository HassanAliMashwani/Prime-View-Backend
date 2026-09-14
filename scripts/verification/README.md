# Prime View — Verification & Concurrency Test Suites

This directory contains automated verification test suites, live concurrency race harnesses, and security regression scripts used to validate Phase 2 milestones and standing ledger requirements.

---

## Environment & Configuration

All test scripts automatically load credentials via `scripts/verification/env-helper.js` from the repository root `.env` file or environment variables:

| Variable | Required By | Description |
|---|---|---|
| `DATABASE_URL` | All DB/RLS tests | Supabase PostgreSQL pooled connection string (port 6543) |
| `DIRECT_URL` | Migrations, Concurrency, Sweeps | Direct PostgreSQL connection string (port 5432) |
| `PORT` | API & Concurrency tests | Backend server port (defaults to `3001`) |
| `TEST_ADMIN_USERNAME` | Auth & API tests | Admin username for test logins (defaults to `admin`) |
| `TEST_ADMIN_PASSWORD` | Auth & API tests | Admin password for test logins (defaults to `password123`) |
| `ENABLE_TEST_SIMULATIONS` | Atomic Rollback test | Must be `true` to allow `simulateRollback` test simulations |
| `SUPABASE_URL` | Storage & Realtime tests | Supabase project API URL |
| `SUPABASE_ANON_KEY` | Realtime tests | Supabase public anonymous client key |

---

## Verification Test Directory

### 1. Concurrency & Transactional Proofs

#### `test-wave5-concurrency.js`
- **What it proves:**
  1. **Dual-Process Concurrency Race:** Spawns two independent OS child processes firing simultaneous `POST /plots/:id/book` requests at the exact same millisecond. Proves PostgreSQL row-level lock serialization: exactly one request receives `HTTP 201 Created` and the other receives `HTTP 409 Conflict` (`PLOT_ALREADY_BOOKED`). Verifies exactly 1 Booking row and 1 `PLOT_BOOKED` AuditEntry are committed to PostgreSQL.
  2. **Atomic Rollback Proof:** Forces a simulated mid-transaction failure during booking document creation. Verifies 100% database rollback with zero orphaned Booking, PaymentRecord, SocietyDocument, or AuditEntry records.
  3. **Dual Reservation Queue:** Verifies simultaneous reservations succeed as concurrent queue entries per Document 02 §4.
- **Tied to Ledger:** `[OI-04]` (Dual-Process Concurrency Verification & Atomic Rollback Proof).
- **Run command:** `node scripts/verification/test-wave5-concurrency.js`

#### `test-wave5-reverse-ordering-race.js`
- **What it proves:**
  Live race in reverse order: A reservation request acquires the plot row lock first (`HTTP 201 Created`, status `active`), followed by a concurrent booking acquiring the lock second. Proves that the winning booking automatically transitions the active reservation to `superseded` (`supersededByBookingId`), updates plot status to `booked`, and records the complete chronological audit trail (`PLOT_RESERVED` → `RESERVATION_SUPERSEDED` → `PLOT_BOOKED`).
- **Tied to Ledger:** `[OI-04]`.
- **Run command:** `node scripts/verification/test-wave5-reverse-ordering-race.js`

#### `test-wave5-reservation-race.js`
- **What it proves:**
  Live simultaneous reservation race on an available plot, verifying multi-process queueing behavior and guard assertions.
- **Tied to Ledger:** `[OI-04]`.
- **Run command:** `node scripts/verification/test-wave5-reservation-race.js`

#### `verify-ov03.js`
- **What it proves:**
  Queries PostgreSQL directly to inspect Plot `OV-03` post-race state, confirming the superseded reservation row, booking row, and chronological audit trail.
- **Tied to Ledger:** `[OI-04]`.
- **Run command:** `node scripts/verification/verify-ov03.js`

#### `wave5-worker.js`
- **Purpose:**
  Standalone worker process invoked by `test-wave5-*.js` to dispatch HTTP booking or reservation mutations at a synchronized millisecond timestamp.

---

### 2. Storage & Object Inspection Proofs

#### `test-storage-real-inspection.js`
- **What it proves:**
  Method B genuine binary byte & magic number inspection:
  1. **Disguised Executable Attack:** File named `photo.jpg` claiming `image/jpeg` containing Windows executable MZ headers (`0x4D 0x5A`) is inspected and rejected with `HTTP 400 Bad Request` (`DISALLOWED_EXECUTABLE_CONTENT`).
  2. **Oversized Payload Attack:** File declaring `image/jpeg` with a 6 MB payload (exceeding 5 MB limit) is rejected with `HTTP 400 Bad Request` (`FILE_TOO_LARGE`).
  3. **Genuine Valid Upload:** File with valid JPEG magic bytes (`0xFF 0xD8 0xFF`) and 200 KB payload is verified and accepted.
- **Tied to Ledger:** `[OI-01]` (Storage Provider Presigned URL & Policy Enforcement Verification).
- **Run command:** `node scripts/verification/test-storage-real-inspection.js`

#### `test-storage-provider-and-postupload.js`
- **What it proves:**
  Direct HTTP behavior against Supabase Storage API (unauthenticated PUT rejected with HTTP 400 `authorization required`) vs. Method B post-upload verification.
- **Tied to Ledger:** `[OI-01]`.
- **Run command:** `node scripts/verification/test-storage-provider-and-postupload.js`

#### `test-supabase-storage-verification.js`
- **What it proves:**
  Supabase Storage integration and path verification.
- **Tied to Ledger:** `[OI-01]`.
- **Run command:** `node scripts/verification/test-supabase-storage-verification.js`

---

### 3. Business Milestone Verification Suites

#### `test-wave1-mutations.js`
- **What it proves:**
  Plot status transitions, area and price adjustments, disputed plot toggling, and admin scope rules for Wave 1.
- **Run command:** `node scripts/verification/test-wave1-mutations.js`

#### `test-wave2-customer-lifecycle.js`
- **What it proves:**
  Customer registration, single-booking workflow, statutory fee creation (admission, share subscription), standard and custom installment plan generation.
- **Run command:** `node scripts/verification/test-wave2-customer-lifecycle.js`

#### `test-wave3-verification.js`
- **What it proves:**
  Payment receipt upload, bank account matching, receipt verification workflow, automated installment schedule balance deduction, and rejection tracking.
- **Run command:** `node scripts/verification/test-wave3-verification.js`

#### `test-wave4-suite.js`
- **What it proves:**
  Sweep service lock expiration (10 min plot lock vs 30 min content block lock), Realtime WebSocket broadcast on lock sweep, and server restart recovery.
- **Tied to Ledger:** `[OI-00]` (Sweep Threshold Mismatch Fix).
- **Run command:** `node scripts/verification/test-wave4-suite.js`

---

### 4. Security & Access Control Regressions

#### `test-scope-regression.js`
- **What it proves:**
  Two-check administrative permission and block scope model: sub-admins without assigned scope cannot book or mutate plots in other blocks (`HTTP 403 OUT_OF_SCOPE`).
- **Run command:** `node scripts/verification/test-scope-regression.js`

#### `test-subadmin-isolation.js`
- **What it proves:**
  Sub-admin block assignment isolation across marketing, liaison, and regional roles.
- **Run command:** `node scripts/verification/test-subadmin-isolation.js`

#### `test-rls-phase2.js`
- **What it proves:**
  PostgreSQL Row Level Security (RLS) enforcement across Phase 2 tables (`Plot`, `Customer`, `Booking`, `PaymentRecord`, `AuditEntry`).
- **Run command:** `node scripts/verification/test-rls-phase2.js`

---

### 5. `scratch/` Subdirectory
The `scratch/` folder contains exploratory and one-off diagnostic scripts preserved for regression testing:
- `test-lockout-live.js` (Account lockout after 5 consecutive failed login attempts)
- `test-suspended.js` (Suspended customer account login rejection)
- `cross-check-screens.js` (Direct DB query cross-check against Phase 1 frontend mockups)
- `test-live.js` (Live API endpoint probe)
- `test-customer.js` (Member customer profile probe)
- `test-plots-id.js` (Single plot ID retrieval probe)
- `test-audit-insert.js` (Audit insert under raw SQL transaction)
- `test-storage-db.js` (Direct SQL query of `storage.objects` table)
- `check-counts.ts` (Seeded table row count check)
- `check-keys.js` (Environment variable sanity check)
