import type { NextConfig } from 'next';

// CSP keeps unsafe-inline on script-src and style-src intentionally: Next.js
// injects inline scripts/styles at runtime (hydration, font optimisation).
// Removing unsafe-inline requires nonce-based CSP which is out of scope for
// Phase 2 hardening.  Tracked for Phase 3.
// Dev-only 'unsafe-eval' is required by Next.js HMR + React Fast Refresh,
// which use eval() for source maps and module updates. Production build
// does not need it.
const isDev = process.env.NODE_ENV === 'development';
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self' data:",
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  devIndicators: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // HSTS: 2-year max-age, include subdomains (Phase 2 baseline)
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

export default nextConfig;
