import { createHash, timingSafeEqual } from 'node:crypto';

type CacheEntry = { lastEnvValue: string; digests: Buffer[] } | null;

let cache: CacheEntry = null;

function getDigests(envValue: string): Buffer[] {
  if (cache !== null && cache.lastEnvValue === envValue) {
    return cache.digests;
  }
  const digests = envValue
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => createHash('sha256').update(t).digest());
  cache = { lastEnvValue: envValue, digests };
  return digests;
}

export function verifyBearer(
  req: Request,
): { ok: true; tokenDigest: string } | { ok: false; reason: 'disabled' | 'missing' | 'invalid' } {
  const envValue = process.env.MC_INGEST_TOKENS ?? '';
  const digests = getDigests(envValue);

  if (digests.length === 0) {
    return { ok: false, reason: 'disabled' };
  }

  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader.toLowerCase().slice(0, 7) !== 'bearer ') {
    return { ok: false, reason: 'missing' };
  }

  const callerToken = authHeader.slice(7);
  const callerDigest = createHash('sha256').update(callerToken).digest();

  let matchedDigest: Buffer | null = null;
  for (const stored of digests) {
    if (timingSafeEqual(callerDigest, stored)) {
      matchedDigest = stored;
    }
  }

  if (matchedDigest !== null) {
    return { ok: true, tokenDigest: matchedDigest.toString('hex') };
  }

  return { ok: false, reason: 'invalid' };
}
