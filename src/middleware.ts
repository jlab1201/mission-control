import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const res = NextResponse.next();
  const reqId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  res.headers.set('x-request-id', reqId);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
