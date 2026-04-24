import { NextResponse, type NextRequest } from 'next/server';

// Mutating methods that carry CSRF risk.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Paths that are intentionally cross-origin and bearer-auth'd.
// Exact-match only — subpaths like /api/ingest/token/reveal are CSRF-protected.
const CROSS_ORIGIN_EXEMPT_PATHS = new Set(['/api/ingest']);
function isCrossOriginExempt(pathname: string): boolean {
  return CROSS_ORIGIN_EXEMPT_PATHS.has(pathname);
}

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const reqId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  res.headers.set('x-request-id', reqId);

  // CSRF / Origin check: only for mutating API requests.
  if (
    MUTATING_METHODS.has(req.method) &&
    req.nextUrl.pathname.startsWith('/api/') &&
    !isCrossOriginExempt(req.nextUrl.pathname)
  ) {
    const origin = req.headers.get('origin');
    if (origin !== null) {
      // Allow only requests whose Origin matches the server's own origin.
      const requestOrigin = req.nextUrl.origin;
      if (origin !== requestOrigin) {
        return new NextResponse('cross-origin rejected', { status: 403 });
      }
    }
    // No Origin header → allow (server-to-server / curl clients omit it).
  }

  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
