---
name: security-audit
description: "Security audit checklist and vulnerability patterns for web applications. Use when auditing code for security issues, implementing authentication, reviewing authorization, checking for OWASP Top 10 vulnerabilities, or hardening an application for production."
---

# Security Audit Guide

## Quick Vulnerability Scan (Grep Patterns)

Run these FIRST — they're cheap (context-friendly) and catch common issues:

```bash
# Hardcoded secrets
grep -rn "password\s*=" --include="*.ts" --include="*.tsx" --include="*.js" | grep -v "test\|spec\|mock\|\.env"
grep -rn "apiKey\|api_key\|secret\|token" --include="*.ts" --include="*.env*" | grep -v "node_modules\|\.env\.example"

# SQL injection risk
grep -rn "raw\|rawQuery\|execute.*\$\{" --include="*.ts" | grep -v "node_modules"

# XSS risk
grep -rn "dangerouslySetInnerHTML\|innerHTML\|document\.write" --include="*.tsx" --include="*.ts"

# Eval / code injection
grep -rn "eval(\|Function(\|setTimeout.*string\|setInterval.*string" --include="*.ts" --include="*.tsx"

# Missing auth checks
grep -rn "export.*async.*function.*(GET\|POST\|PUT\|DELETE\|PATCH)" --include="route.ts" | head -20

# Console.log in production code (potential data leak)
grep -rn "console\.log" --include="*.ts" --include="*.tsx" | grep -v "test\|spec\|node_modules"
```

## OWASP Top 10 Audit Checklist

### 1. Injection (SQL, NoSQL, Command)
- [ ] All database queries use parameterized queries (Prisma/Drizzle handle this)
- [ ] No string concatenation in any query builder
- [ ] No `$executeRaw` or `$queryRaw` with user input
- [ ] Command execution (child_process) sanitizes all input

### 2. Broken Authentication
- [ ] Passwords hashed with Argon2id (preferred) or bcrypt (cost 12+)
- [ ] Session cookies: HttpOnly, Secure, SameSite=Lax
- [ ] Access tokens expire in 15 minutes
- [ ] Refresh tokens rotate on use
- [ ] Rate limiting on login: 5 attempts per 15 minutes per IP
- [ ] Account lockout after repeated failures
- [ ] Password reset tokens expire in 1 hour, single-use

### 3. Sensitive Data Exposure
- [ ] All traffic over HTTPS (HSTS header set)
- [ ] No secrets in source code (use .env + validation)
- [ ] No sensitive data in logs (sanitize before logging)
- [ ] No sensitive data in error messages (generic messages to users)
- [ ] Database encryption at rest enabled
- [ ] PII masked in non-production environments

### 4. Broken Access Control
- [ ] Every API endpoint checks authentication
- [ ] Every resource access checks authorization (IDOR prevention)
- [ ] Deny by default — explicit permission grants only
- [ ] Admin endpoints have role checks
- [ ] File upload paths validated (no path traversal)
- [ ] CORS configured with specific origins (no wildcard *)

### 5. Security Misconfiguration
- [ ] No default credentials anywhere
- [ ] Error pages don't leak stack traces in production
- [ ] Directory listing disabled
- [ ] Unnecessary HTTP methods disabled
- [ ] All security headers set (see below)

### 6. XSS (Cross-Site Scripting)
- [ ] No `dangerouslySetInnerHTML` without DOMPurify sanitization
- [ ] Content-Security-Policy header configured
- [ ] User input HTML-escaped before rendering
- [ ] Rich text input sanitized with DOMPurify before storage

### 7. Known Vulnerabilities
- [ ] `npm audit` shows 0 critical/high vulnerabilities
- [ ] All dependencies on supported versions
- [ ] Automated dependency updates enabled (Renovate/Dependabot)
- [ ] Lock file committed and used in CI

### 8. Insufficient Logging
- [ ] Failed login attempts logged with IP and timestamp
- [ ] Authorization failures logged
- [ ] Data access logged for sensitive resources
- [ ] Logs don't contain passwords, tokens, or PII
- [ ] Log retention policy configured

## Required Security Headers

```typescript
const headers = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "connect-src 'self' https://api.yourdomain.com",
    "frame-ancestors 'none'"
  ].join('; '),
};
```

## Rate Limiting Pattern

```typescript
// Using a Redis sliding window
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'), // 10 requests per 10 seconds
  analytics: true,
});

// Stricter for auth endpoints
const authRatelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '15 m'), // 5 per 15 minutes
});
```
