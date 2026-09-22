# Changelog — Prime View Backend

## [P2-03] - 2026-09-23

### Added
- **Derived Disputed Display Status (Visual-only, zero DB mutations):**
  - Created `src/plots/display-status.ts` with `resolveDisplayStatus(plot, ownerAccountStatus)` and `attachDisplayStatus(plot)` helpers.
  - Precedence: `stored disputed (plot.status === 'disputed')` → `displayStatus: 'disputed'` (preserves `plot.disputeReason`). Else if `owner.accountStatus === 'suspended'` → `displayStatus: 'disputed', displayStatusReason: 'Disputed — customer account suspended'`. Else `displayStatus = plot.status`.
  - `PlotsService.findAll` and `findOne` now `include: { currentOwner: { select: { id, accountStatus } } }` and map through `attachDisplayStatus`. No N+1 queries.
  - `CustomersService.toggleSuspension`: replaced `{ role: 'super_admin' }` bypass with caller `session` in `withScopedSession`.
- **Section 0 (P2-02 Leftovers) — Completed:**
  - 0.1 RLS Fold: `system_sweep` policies folded idempotently into `prisma/rls.sql` and `prisma/rls_updates.sql`. `rls_system_sweep.sql` is a pointer-only.
  - 0.2 JWT/Source Guard: `PrismaService.withScopedSession` rejects any JWT presenting `role: 'system_sweep'` without `source: 'sweep'`.
  - 0.3 HTTP Re-Proof: `allotted` and `disputed` plots return `409 PLOT_NOT_AVAILABLE` on reserve and lock endpoints.

### Unchanged (by design)
- `Plot.status` column is NEVER written by suspend/reinstate.
- SweepService, inventory overview, lock/reserve guards all use stored `plot.status`.
- OI-12 (plot-a-01 dual booking) and OI-13 (5 booked elite plots, no owner) remain OPEN and untouched.

---

## [P2-02] - 2026-09-22

### Changed
- **Reservation Hold Default (24 Hours):**
  - Updated `PlotsService.reservePlot` to default hold duration to 24 hours (1 day) instead of 7 days: `dto.validHours ?? (dto.validDays ? dto.validDays * 24 : 24)`.
  - Added optional `validHours` field to `ReservePlotDto`.
  - Existing reservations kept untouched (0 active reservations in database; all historical expiries preserved).
- **SweepService System Session & Plot Guard:**
  - Replaced hardcoded `{ role: 'super_admin' }` bypass in `SweepService.runSweep` with a documented dedicated system session object: `{ role: 'system_sweep', adminId: 'sweep' }`.
  - Added `prisma/rls_system_sweep.sql` configuring Row-Level Security policies on `Plot`, `Reservation`, `Booking`, `AuditEntry`, and `ContentBlock` to recognize and authorize `system_sweep`.
  - Updated SweepService reservation expiry handler to guard and prevent flipping `allotted` or `disputed` plots to `available` upon reservation expiry.
- **Reservations Service Scoping:**
  - Removed `{ role: 'super_admin' }` hardcoding in `ReservationsService.getReservationMeta` and passed the actual caller `session` into `withScopedSession(session)`.
- **Status Guards (No Regression from P2-01):**
  - Confirmed and updated `PlotsService.acquireLock` and `PlotsService.reservePlot` to reject `allotted` and `disputed` plots with typed conflict exceptions.
