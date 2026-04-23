import {
  INGEST_RATE_BURST,
  INGEST_RATE_REFILL_PER_SEC,
} from "@/lib/config/runtime";

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();
let gcCounter = 0;

export function acquire(tokenDigest: string): boolean {
  const now = Date.now();

  gcCounter += 1;
  if (gcCounter >= 100) {
    gcCounter = 0;
    const staleThreshold = now - 10 * 60 * 1000;
    for (const [key, bucket] of buckets) {
      if (bucket.updatedAt < staleThreshold) {
        buckets.delete(key);
      }
    }
  }

  let bucket = buckets.get(tokenDigest);
  if (bucket === undefined) {
    bucket = { tokens: INGEST_RATE_BURST, updatedAt: now };
    buckets.set(tokenDigest, bucket);
  }

  const elapsed = now - bucket.updatedAt;
  const refilled = Math.min(
    INGEST_RATE_BURST,
    bucket.tokens + (elapsed / 1000) * INGEST_RATE_REFILL_PER_SEC
  );

  if (refilled >= 1) {
    bucket.tokens = refilled - 1;
    bucket.updatedAt = now;
    return true;
  }

  bucket.tokens = refilled;
  bucket.updatedAt = now;
  return false;
}
