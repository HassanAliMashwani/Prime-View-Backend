# Outstanding items (2026-09-24)

## Later — cloud (do not implement until asked)
- **OI-01** Live storage provider signed upload + provider-side MIME/size reject.
- **OI-03** Cloudflare R2 for public CMS media (or a later “won’t do”).
- **OI-06** SMS + Resend transactional email.
- **OI-07** Two-device Realtime reconnect / refetch.
- **OI-09** Supabase PITR + DR runbook.
- **OI-10** App host region next to the database.

## Open — this slice (secrets + leftover APIs)
- **OI-05** Remove ADMIN_ACCESS_SECRET from frontend middleware. JWT + RBAC only.
- **OI-08** Remove CustomersService default portal password `password123`.
  Require an explicit password or generate a one-time random and force reset.
  No hardcoded admin/member passwords in source.
- **OI-11** Leftover product APIs (build any that are still missing):
  - GET /admin/audit (if not live)
  - POST/DELETE customer documents (if not live)
  - Customer self-service profile update
  - Customer password change
  - Admin password reset (super_admin → other admin)
  - Admin plot price update (plot.price only; never PaymentRecord.amount)
  - Sales reports / KPIs endpoint the admin sales page already expects

## Later — small (not this slice)
- **OI-14** Empty-role RLS (`app.current_role = ''`). Login/public verify still need a privileged path.
- **OI-15** Login lockout remaining-time on the login page.

## Resolved (one line each — not open work)
- OI-00 Sweep test threshold — resolved Wave 4.
- OI-04 Dual-process concurrency — resolved Wave 5.
- OI-12 A-01: live booking book-1789346204123-dlee; second void; allotted; owner cust-1.
- OI-13 Elite 34/94/128/147/254 released to available.
- Phase 2: inventory JWT + contrast; Elite 120 Mashwani 25M one-time; white allotted labels;
  no login password123; no withScopedSession({ role: 'super_admin' }).
