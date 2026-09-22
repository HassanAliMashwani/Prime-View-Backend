# Changelog — Prime View Backend

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
