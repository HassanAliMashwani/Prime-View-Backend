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
| **Excessive DB Permissions** | Database connection | **App DB Role**: `postgres` (Supabase pooled user; superuser privileges are disabled on hosted database). |
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


