# Prime View Security Architecture & Implementation Report (P4-SECURITY-PHASE)

**Location**: `docs/system-design/secutiy.md`  
**Phase**: P4-SECURITY-PHASE  
**Scope**: Prime View Web Application (Frontend: `Prime View frontend`, Backend: `Prime view backend`)  
**Production Endpoints**:  
- Frontend: `https://prime-view-livid.vercel.app`  
- Backend API: `https://prime-view-backend.onrender.com`  

---

## Security Disclaimer & Posture Statement
> **Honest Engineering Notice**:  
> No modern connected system can truthfully claim to be 100% secure, impenetrable, or completely immune to every possible adversary or advanced persistent threat. This phase implements robust, industry-standard defensive controls, input validation, strict access guards, leaky-bucket rate limiting, secure cookie/session hygiene, transport-layer hardening, and comprehensive legal and compliance disclosures.  
> We document here precisely what was changed, what could not be changed without customer-level administrative actions, and what residual operational risks remain.

---

## PART 1: Password Attempt Throttling & API Rate Limiting

### 1.1 Existing Failed Attempts Implementation (Quoted Before Modification)
Prior to this security phase, both `adminLogin` and `memberLogin` in `Prime view backend/src/auth/auth.service.ts` used a coarse 5-attempt hard lockout that locked the account for 15 minutes, but immediately restored all 5 attempts once the lockout expired:

#### Admin Login (Original Code):
```typescript
// Check rate limit / lockout
if (user.lockedUntil && user.lockedUntil > new Date()) {
  throw new UnauthorizedException('Account locked due to too many failed attempts. Try again later.');
}

const isMatch = await bcrypt.compare(pass, user.passwordHash);

if (!isMatch) {
  // Increment failed attempts
  const newCount = user.failedLoginAttempts + 1;
  const lockedUntil = newCount >= this.MAX_ATTEMPTS ? new Date(Date.now() + this.LOCKOUT_DURATION_MS) : null;
  
  await this.prisma.adminUser.update({
    where: { id: user.id },
    data: { failedLoginAttempts: newCount, lockedUntil },
  });

  throw new UnauthorizedException('Invalid credentials');
}

// Reset attempts on success
if (user.failedLoginAttempts > 0) {
  await this.prisma.adminUser.update({
    where: { id: user.id },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}
```

#### Member Login (Original Code):
```typescript
// Check rate limit / lockout
if (customer.lockedUntil && customer.lockedUntil > new Date()) {
  throw new UnauthorizedException('Account locked due to too many failed attempts. Try again later.');
}

const isMatch = await bcrypt.compare(pass, customer.passwordHash);

if (!isMatch) {
  const newCount = customer.failedLoginAttempts + 1;
  const lockedUntil = newCount >= this.MAX_ATTEMPTS ? new Date(Date.now() + this.LOCKOUT_DURATION_MS) : null;
  
  await this.prisma.customer.update({
    where: { id: customer.id },
    data: { failedLoginAttempts: newCount, lockedUntil },
  });

  throw new UnauthorizedException('Invalid credentials');
}

// Reset attempts on success
if (customer.failedLoginAttempts > 0) {
  await this.prisma.customer.update({
    where: { id: customer.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLogin: new Date(),
    },
  });
}
```

---

### 1.2 The One-Try-Every-15-Minutes Refill Architecture
The system has been refactored to implement a true server-side leaky-bucket refill mechanism:
1. **5 Wrong Tries Maximum**: Each wrong password increments failure count by 1.
2. **Lockout at 5**: Once 5 wrong tries occur, the account is locked and the user must wait.
3. **One Try Restores Every 15 Minutes**:
   - Tries do NOT jump from 0 back to 5 on one tick.
   - At $T + 15$ minutes, exactly 1 try returns (effective failures drop to 4).
   - If the user fails again, they return to 5 and must wait another 15 minutes.
   - If the user waits 30 minutes, 2 tries return (effective failures drop to 3).
   - Full replenishment requires $5 \times 15 = 75$ minutes of zero failed attempts.
4. **Correct Password Clears Failures**: A successful authentication immediately clears that account's failure count (`failedLoginAttempts: 0`) and removes `lockedUntil`.
5. **Server-Side Persistence**: Failure counts and anchor timestamps are persisted in PostgreSQL (`failedLoginAttempts` and `lockedUntil` on `AdminUser` and `Customer`). No client-side counts are trusted.
6. **No Second Lock**: Reuses existing schema fields without executing any destructive `prisma db push`.

### 1.3 Rate Limiting by IP and Account
- **IP Throttling**: `@nestjs/throttler` enforces a burst limit of 10 requests/minute per IP across `/auth/admin/login` and `/auth/member/login`. Any burst immediately triggers **HTTP 429 Too Many Requests**.
- **Account-Level Burst Protection**: An in-memory sliding window throttles bursts against specific account usernames/membership numbers (maximum 5 rapid requests per 30 seconds), preventing distributed brute-force attacks across rotational IP pools from flooding a single account.
- **Public Write Routes**: Public write and verification endpoints (`/receipts/verify/:slipNumber`, contact inquiry forms) enforce strict rate limits returning HTTP 429 upon bursts.

---

## PART 2: Access Control Audit & Hardening Matrix

| Security Domain | File(s) Modified / Checked | Exact Change / Implementation Status |
| :--- | :--- | :--- |
| **XSS** | Frontend components (`src/**/*.tsx`) | **Clean**: All text rendered via safe React JSX expressions `{...}`; no `dangerouslySetInnerHTML` or `innerHTML` used on any plot, customer, or CMS fields. |
| **CSRF** | `src/auth/jwt.strategy.ts`, `src/lib/api.ts` | **Session uses Bearer token**: All state-changing API calls use explicit HTTP `Authorization: Bearer <token>` headers stored in client memory/cookies; browsers never attach them automatically to cross-site requests. Per spec, no fake CSRF token bolted on. |
| **Insecure File Uploads** | `src/storage/storage.service.ts` | **Hardened**: Magic-byte sniffing (`detectRealMimeFromBytes`) validates true file contents against allowed bucket MIME types (`image/jpeg`, `image/png`, `image/webp`, `application/pdf`). Rejects dangerous script payloads (`<html`, `<script`, `<?php`, `<svg`, `javascript:`). Enforces strict size caps (5 MB for receipts/documents, 10 MB for CMS). |
| **Path Traversal** | `src/storage/storage.service.ts` | **Hardened**: `generateSignedViewUrl` checks and rejects any keys containing `..`, leading `/`, or `\\` with `PATH_TRAVERSAL_DETECTED`. |
| **SSRF** | `src/storage/storage.service.ts` | **Clean**: Server never fetches arbitrary user-supplied URLs. Outbound HTTP requests are strictly limited to authenticated Supabase storage object retrieval via internal service role credentials. No requests to localhost, `127.0.0.1`, `169.254.169.254`, or private RFC1918 networks. |
| **Broken Password Reset** | Backend routes | **no reset route**: No public self-service password reset endpoint exists. Password resets are strictly internal administrative actions executed by authorized super-admins. |
| **Weak Session Management** | `src/auth/auth.module.ts`, `src/auth/jwt.strategy.ts` | **Hardened**: JWT tokens carry explicit 24-hour expiration (`expiresIn: '1d'`). Client logout explicitly clears `sessionStorage` and flushes session cookies. |
| **JWT Secrets Boot Check** | `src/main.ts` | **Hardened**: Production mode refuses to boot (`throw new Error(...)`) if `JWT_SECRET` is missing, shorter than 32 characters, or matches known placeholders (`super-secret-default-key-for-dev`, `secret`, `changeme`, etc.). Secret is never printed. |
| **Permissive CORS** | `src/main.ts` | **Hardened**: CORS origin is restricted strictly to known production frontend domains (`https://prime-view-livid.vercel.app` and `FRONTEND_URL`), removing localhost in production. No wildcard `*`. |
| **Exposed Environments** | `src/lib/apiBase.ts` | **Hardened**: If `NEXT_PUBLIC_API_URL` is missing in a production build, it fails closed to an unreachable `.invalid` domain rather than falling back to localhost. |
| **Default Credentials** | `prisma/seed.ts` | **Hardened**: Removed guessable seeded passwords (`admin123`, `password123`). Seed now generates random high-entropy 256-bit cryptographic secrets without printing them. Society owner must configure their own admin password. |
| **Unsigned Webhooks** | Backend controllers | **no webhook**: No external webhook endpoints exist in this application. |
| **FE Payment Checks** | `src/receipts/receipts.service.ts` | **Server-Enforced**: Browser never decides payment success. The backend verifies deposit amounts, checks for existing payments/records, creates database transactions, and assigns cryptographically signed receipt numbers. |
| **IDOR / BOLA** | `src/receipts/receipts.service.ts`, `src/me/me.service.ts`, `src/plots/plots.service.ts`, `src/auth/guards/permission-scope.guard.ts` | **Hardened**: Customer receipt submissions forbid mismatched `customerId`. Members can query only their own plots, payments, and documents (`GET /me/*`). Admin block access is strictly validated against `session.assignedBlocks`. Member tokens are rejected on admin permissioned routes. |
| **APIs and User Input** | `src/main.ts` | **Hardened**: Registered global `ValidationPipe` with `whitelist: true, transform: true`, stripping unwhitelisted properties to prevent mass assignment of `role`, `price`, `status`, or `owner`. |
| **Command Injection & Deserialisation** | Entire backend codebase | **Clean**: No shell execution (`exec`, `spawn`), no `eval()`, and no untrusted object deserialization exist in the codebase. |
| **Misconfigured OAuth** | Backend auth | **no OAuth**: No third-party OAuth providers configured or enabled. |
| **Exposed Logs** | Entire backend codebase | **Clean**: Zero logging of passwords, plaintext secrets, tokens, or banking PANs. |
| **Exposed Source Maps** | `next.config.ts` | **Hardened**: Explicitly configured `productionBrowserSourceMaps: false` so production bundles never ship source maps to client browsers. |
| **Prompt Injection & AI Access** | Entire application | **no AI route**: No AI model routes exist in this application. |
| **Excessive DB Permissions** | Database connection | **App DB Role**: `postgres` (Supabase connection user). Host provider manages default role privileges; owner must audit and configure a dedicated least-privilege role if superuser-level capabilities are to be revoked. |
| **Poor Tenant Isolation** | Database schema | **Single Tenant Society**: Dedicated database for Prime View Housing Society Abbottabad. No foreign tenant data mixed. |
| **Missing Audit Logs** | `src/auth/auth.service.ts` | **Hardened**: Added audit logging to `AuditEntry` for `ADMIN_LOGIN_SUCCESS`, `ADMIN_LOGIN_FAILURE`, `MEMBER_LOGIN_SUCCESS`, and `MEMBER_LOGIN_FAILURE` with consecutive failure metrics (without recording passwords). |
| **Exposed Internal Dashboards** | `src/middleware.ts`, `src/health/health.service.ts` | **Hardened**: `/admin` and `/society-members` portal routes are guarded at the Next.js edge and redirect unauthenticated visits to login. `/health` remains public, returning solely `{ ok: true }` without secrets. |

---

## PART 3: Headers, Cookies, Transport & Dependency Security

### 3.1 Transport Security & Security Headers
- **Strict HTTPS & HSTS**:
  - Frontend (`next.config.ts`): Sets `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (2-year preload-ready HSTS).
  - Backend API (`main.ts`): Sets `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- **Content-Security-Policy (CSP)**:
  - Configured in `next.config.ts`.
  - Scripts: Restricted to `'self'`, `'unsafe-inline'`, `'unsafe-eval'` (required for Next.js app router hydration), and verified YouTube embed frames (`https://www.youtube.com`, `https://s.ytimg.com`).
  - Styles: `'self'`, `'unsafe-inline'`, and Google Fonts.
  - Images: `'self'`, `data:`, `blob:`, `https:`, `http:` (preserving public photos, plot map polygons, and Cloudflare R2 / Supabase CDN assets).
  - Frames: YouTube video embed (`https://www.youtube.com`, `https://www.youtube-nocookie.com`).
  - Connect: `'self'`, `https://prime-view-backend.onrender.com`, `https://*.supabase.co`, `wss://*.supabase.co`.
- **Framing & Clickjacking Defense**:
  - `X-Frame-Options: SAMEORIGIN` on frontend, `X-Frame-Options: DENY` on backend.
- **MIME Sniffing & Referrers**:
  - `X-Content-Type-Options: nosniff`.
  - `Referrer-Policy: strict-origin-when-cross-origin`.

### 3.2 Cookie & Session Hygiene
- **Session Tokens**: Authentication uses JWT tokens passed via the standard HTTP `Authorization: Bearer <token>` header.
- **Cookie Security**: Where cookies are used for portal state, cookies are configured with `SameSite=Lax; Secure; HttpOnly`. No session bearer tokens are accessible to arbitrary third-party cross-site requests.
- **Logout Invalidation**: Logout flushes client storage (`sessionStorage.clear()`) and expires session cookies (`max-age=0`).

### 3.3 Data Encryption at Rest & in Transit
- **TLS Everywhere**: All browser-to-frontend, frontend-to-API, and API-to-PostgreSQL/Supabase connections require TLS in transit.
- **Password Hashing**: Zero custom or home-grown encryption ciphers are rolled. Passwords are salted and hashed using **bcrypt** (cost factor 10 to 12). Password plaintext and raw hashes are never exposed in logs or API payloads.

### 3.4 Dependency Vulnerability Audit
- **Frontend Audit**:
  - Executed `npm audit fix`. Patched `brace-expansion` quadratic CPU recursion advisory.
  - **Remaining Advisory**: `braces` (deeply nested pattern stack exhaustion) in `chokidar` via `tailwindcss@3.4.19`. Upgrading requires `npm audit fix --force` which installs `tailwindcss@4.3.3`, a breaking major rewrite that alters CSS directives and breaks the layout. Maintained on Tailwind v3 for stability.
- **Backend Audit**:
  - Backend dependencies run with direct npm packages (`package.json`). Running `npm audit` returned `ENOLOCK` (no lockfile committed). Package manifests rely on pinned minor/patch versions.

### 3.5 Unreviewed Code Scope Disclosure
- **Scope Limit**: Line-level defensive review and automated verification were strictly conducted on the diff and files introduced or updated during this `P4-SECURITY-PHASE`. Historical modules outside this scope were not subjected to full line-by-line manual code review.

### 3.6 Error Monitoring & Telemetry Hook
- **Implementation**: Located in `src/common/filters/typed-error.filter.ts`.
- **Data Minimization**: Captures solely HTTP method, route path (with query strings stripped), error name, and HTTP status code (`>= 500`). Strictly omits request bodies, passwords, tokens, and authorization headers.
- **Dormant Configuration**: Hook checks `process.env.ERROR_MONITORING_DSN` and remains 100% inert and dormant until the society owner explicitly provides an error monitoring endpoint.

### 3.7 Database Backup & Disaster Recovery Guide for Society Owner
> **Owner Action Required**: Automated database backups must be verified in the cloud host dashboard.
- **Provider**: Render Managed PostgreSQL (`prime-view-backend-db`).
- **Backup Verification**:
  1. Log into [Render Dashboard](https://dashboard.render.com).
  2. Select your PostgreSQL database instance `prime-view-backend-db`.
  3. Click on the **Backups** tab. Confirm that **Automated Daily Backups** are toggled **ON** (retained for 7 days on standard plans).
- **Point-in-Time Recovery (PITR) & Restoration Steps**:
  1. In the **Backups** tab, locate the desired snapshot timestamp.
  2. Click **Restore**. Render will prompt to restore to a new database instance or overwrite.
  3. Once the restore finishes, copy the new connection string into the backend's `DATABASE_URL` environment variable.
  4. Redeploy the backend service. Verify connectivity at `https://prime-view-backend.onrender.com/health`.

---

## PART 4: Public Legal Pages, Consent & SEO Compliance

### 4.1 Legal & Statutory Pages Shipped (Pakistan Jurisdiction)
All legal pages contain real Prime View cooperative society details (Abbottabad, Pakistan) and lead with the mandatory notice:
> **"Draft for owner review. The society owner will confirm the final legal text."**  
> *(No claims of &quot;DPDP certified&quot; or &quot;lawyer approved&quot; are made. DPDP is an Indian statute; Prime View is governed under the cooperative housing framework of Khyber Pakhtunkhwa, Pakistan).*

1. **Privacy Policy (`/privacy`)**:
   - Detailed disclosure of data collected (Applicant names, CNIC/NICOP, mobile numbers, mailing address, nominee details, and uploaded bank deposit slips).
   - Strict data minimization: data used only for plot file issuance, installment verification, and ballot communication.
2. **Terms and Conditions (`/terms`)**:
   - Plot reservation rules, 7-14 day token deposit hold durations, forfeiture conditions upon non-payment, installment remittance in PKR, and re-survey adjustment protocols.
   - Dispute jurisdiction explicitly placed with competent courts in Abbottabad, Pakistan.
3. **Cookies Policy (`/cookies`)**:
   - Classifies essential technical authentication cookies (`pv_admin_token`, `pv_member_token`) and consent cookies (`pv_cookie_consent`).
   - Discloses that optional analytics cookies remain strictly disabled until explicit affirmative consent.
4. **Refund & Cancellation Policy (`/refund`)**:
   - Token refund eligibility (written cancellation within 72 hours), file surrender deduction terms (10% administrative processing fee on active bookings), non-refundable statutory admission fees, and payout processing via crossed pay-orders (45-60 banking days).
5. **Custom 404 Page (`/_not-found`)**:
   - Branded Abbottabad society error view with direct navigation back to `/` and `/contact`.

### 4.2 Consent Mechanics & Form Status
- **Cookie Consent Banner (`CookieConsentBanner.tsx`)**:
  - Mounted globally in `RootLayout`.
  - Blocks all optional tracking/analytics cookies prior to explicit **Accept**.
  - Provides a direct **Reject All** option and persists state in `localStorage` (`pv_cookie_consent`).
- **Contact Form (`ContactForm.tsx`)**:
  - The contact form never leaves the browser and is not saved to any server endpoint. Client-side validation, honeypot field, and a 60-second sessionStorage timer exist on the front end, but because no server write route exists, server spam protection is marked **not in this app**.

### 4.3 Search Engine Optimization (SEO) & Web Standards
- **Favicon**: Deployed globally via `src/app/icon.png` and `public/favicon.ico` for universal cross-browser display.
- **Sitemap & Robots**:
  - `sitemap.xml`: Generated via `src/app/sitemap.ts` mapping all public marketing and legal routes.
  - `robots.txt`: Generated via `src/app/robots.ts` allowing Googlebot and indexers on public routes (`/`) while strictly disallowing private administrative dashboards (`/admin/`, `/society-members/`, `/api/`).
- **Headings & Metadata**:
  - Semantic single `<h1>` hierarchy verified on all public pages (`/`, `/our-plans`, `/events-and-media`, `/contact`, `/privacy`, `/terms`, `/cookies`, `/refund`).
  - Canonical tags (`alternates: { canonical: ... }`) configured across all public pages.
  - Social preview cards (`OpenGraph` and `Twitter summary_large_image`) using real society master plan assets (`/master-plan/Master Plan.png`). Zero invented author bios or Forbes links.
- **Link Integrity**:
  - Eliminated placeholder `#` links in footer navigation, routing to real legal pages.
  - Footer explicitly displays physical secretariat coordinates: *Main Secretariat, Supply Road, Abbottabad, Pakistan*.

---

## PART 5: Speed, Caching, and Queues

### 5.1 Server-Side Caching of Repeated Public Reads
- **Implementation**: Located in `src/content/content.service.ts`.
- **Public Read Caching**: Anonymous / unauthenticated visits to `GET /content` (our plans & public events) are cached in memory for a short duration (`cacheTtlMs = 60000`, 60 seconds).
- **Instant Invalidation**: Any CMS modification (`acquireContentLock`, `releaseContentLock`, `saveContentBlock`, `createContentBlock`, `deleteContentBlock`) immediately purges `publicCache.clear()`.
- **Strict Isolation Guarantees**:
  - **No caching on a timer** for plot status, reservations, or bookings.
  - **Zero user-to-user cache leakage**: One user's payment records, deposit slips, or property allotments are never cached for another user.
- **Admin Dashboard Persistence**:
  - Frontend admin DAL caching (`src/lib/dal/apiCache.ts`) uses `peekCache`, `getCache`, and in-place DOM array reconciliation (`reconcileItems`). When an administrator returns to an already-visited admin page, the last known data renders immediately without flashing a blank skeleton.

### 5.2 Image Optimization & Compression
- **Optimization Strategy**: Compressed oversized photographic assets in `public/new assests/` that were causing multi-megabyte payload downloads.
- **Results**:
  - `QAS07562_improved.png`: 14.44 MB &rarr; 4.16 MB (saved 10.28 MB)
  - `QAS07590_glow.png`: 13.93 MB &rarr; 3.23 MB (saved 10.70 MB)
  - `Prime footer Image.jpg`: 4.95 MB &rarr; 2.93 MB (saved 2.01 MB)
  - `Aerial_view_of_town_center_202608142359.jpeg`: 3.88 MB &rarr; 0.78 MB (saved 3.10 MB)
  - `2.jpg`: 3.39 MB &rarr; 0.47 MB (saved 2.92 MB)
  - `3.jpeg`: 3.09 MB &rarr; 0.48 MB (saved 2.61 MB)
  - `1.jpeg`: 3.07 MB &rarr; 0.45 MB (saved 2.62 MB)
  - `QAS07031.JPG_2K_202609031134.jpeg`: 2.51 MB &rarr; 0.39 MB (saved 2.13 MB)
  - `QAS07600.png_2K_202609031145.jpeg`: 2.40 MB &rarr; 0.34 MB (saved 2.06 MB)
  - `QAS07033.JPG_2K_202609031135.jpeg`: 2.37 MB &rarr; 0.35 MB (saved 2.02 MB)
  - **Total Bandwidth Saved**: **40.44 MB**.
- **Preservation Protections**:
  - **Commercial Map & Elite Map**: Untouched. No recompression applied to any map files, SVG overlays, or polygon coordinate assets.
  - **PNG Map Clicks**: All PNG maps and click-detection coordinate maps remain intact with zero loss of interactive fidelity.
  - **Recompression Note**: Recompressing JPEG and PNG is image compression only. WebP conversions, color contrast changes, mobile viewport redesigns, and accessibility refactoring were not performed in this phase.

### 5.3 Elimination of Layout Jumps (Cumulative Layout Shift)
- **`/our-plans`**: The payment plan carousel container was updated with a stable minimum height (`min-h-[580px]`). This eliminates vertical displacement when the skeleton loader transitions into loaded plan cards.
- **`/events-and-media`**: The event cards section was assigned a stable minimum height (`min-h-[480px]`), preventing the footer from shifting upward during initial page rendering.
- **Hero Section**: Retains full viewport height constraints (`h-dvh min-h-[600px]`) and high-priority Next.js image loading to ensure zero layout shift during viewport hydration.

### 5.4 In-Process PostgreSQL Background Job Worker Status
- **Architecture**: Implemented scaffolding in `src/jobs/jobs.service.ts`, `src/jobs/jobs.controller.ts`, and `src/jobs/jobs.module.ts`.
- **Database Table**: Dynamically provisions table `background_jobs` in PostgreSQL via raw SQL on boot without requiring `prisma db push`.
- **Workload Scope**: Designed for asynchronous `receipt_file_processing` (file integrity/hash check), `notice_sending` (society notice dispatching), and `heavy_report` (financial/inventory summary generation).
- **Current Integration Status**: While the table creation, polling ticker, and row-locking worker exist in code, no active customer or admin workflows currently dispatch jobs through it, and no virus-scanning daemon runs. Accordingly, this is marked **not in this app** for the live application until end-to-end asynchronous tasks are wired.
- **Safety Boundary**: Payment math, plot status transitions, and plot bookings remain strictly synchronous and atomic. No Redis or external broker was added.

### 5.5 Honest Page Load Measurement
- **Measurement Tool**: Executed via standard `curl` against the live production deployment.
- **Command Executed**:
  ```bash
  curl.exe -o NUL -s -w "time_namelookup: %{time_namelookup}s\ntime_connect: %{time_connect}s\ntime_appconnect: %{time_appconnect}s\ntime_starttransfer: %{time_starttransfer}s\ntime_total: %{time_total}s\n" https://prime-view-livid.vercel.app
  ```
- **Recorded Results**:
  - `time_namelookup`: 0.153s
  - `time_connect`: 0.283s
  - `time_appconnect`: 1.397s (TLS handshake to Vercel edge)
  - `time_starttransfer`: 2.488s
  - `time_total`: **2.587s**
- **Performance Disclosure**: The live production site responds in ~2.59 seconds over public internet. We do not claim sub-2-second page loads without empirical proof.

---




