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

