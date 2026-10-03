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
