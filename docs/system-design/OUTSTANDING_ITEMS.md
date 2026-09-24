# Outstanding items

## Later — cloud (do not implement until asked)
- **OI-01** Live storage provider signed upload + provider-side MIME/size reject.
- **OI-03** Cloudflare R2 for public CMS media (or a later “won’t do”).
- **OI-06** SMS + Resend transactional email.
- **OI-07** Two-device Realtime reconnect / refetch.
- **OI-09** Supabase PITR + DR runbook.
- **OI-10** App host region next to the database.

## Later — small (not this slice)
- **OI-14** Empty-role RLS (`app.current_role = ''`). Login/public verify still need a privileged path.
- **OI-15** Login lockout remaining-time on the login page.

## Later — after the whole project (do not implement until asked)
- **OI-16** Enterprise CI/CD (GitHub Actions + existing Vercel/Render).
  Do this only after product/cloud leftovers are done. Not now.
  Goal: broken code never reaches production. CI = quality gate.
  CD stays Vercel (frontend) and Render (backend). No Jenkins, no
  extra Kubernetes, no second deploy path.
  How it should work later:
  1. No direct push to main. PR required. main protected:
     required GitHub Action must be green before merge.
  2. Frontend repo PR: npm ci, lint, tsc --noEmit, next build,
     fail if .env is in the tree. Vercel Preview on the PR.
  3. Backend repo PR: npm ci, lint, tsc, prisma validate,
     nest build, unit tests (balloon, one-person 409, money),
     npm audit (high/critical).
  4. Merge to main → same checks → Vercel Production + Render
     Production only if checks pass (Vercel: use existing GitHub
     checks; Render: deploy main after merge only).
  5. Environments: Preview (PR) / Staging (copy schema, not prod
     data) / Production. Secrets only in Vercel, Render, and
     GitHub Environments — never in the repo.
  6. Never run prisma migrate deploy against production from a PR
     or from the CI “check” job. Prod migrate = manual or
     workflow_dispatch after approval.
  7. Also later: Dependabot, secret scanning + push protection,
     CodeQL on PRs.
  8. Do not: CI using production DATABASE_URL; auto-migrate prod
     on every merge; Playwright against live admin with real
     passwords; deploy from Actions AND auto-deploy (double ship).
  Owner still rotates host secrets (DB, JWT, admin, Supabase).
  Staff can keep testing book / portal / receipts without this.

## Resolved (one line each — not open work)
- OI-00 Sweep test threshold — resolved Wave 4.
- OI-04 Dual-process concurrency — resolved Wave 5.
- OI-05 ADMIN_ACCESS_SECRET removed; JWT only.
- OI-08 no password123 default; create member requires password.
- OI-11 audit, customer docs, profile, password change, admin password reset, plot price (409 if paid ledger), sales KPIs.
- OI-12 A-01: live booking book-1789346204123-dlee; second void; allotted; owner cust-1.
- OI-13 Elite 34/94/128/147/254 released to available.
- Phase 2: inventory JWT + contrast; Elite 120 Mashwani 25M one-time; white allotted labels; no login password123; no withScopedSession({ role: 'super_admin' }).
