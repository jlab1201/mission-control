---
name: api-integration
description: "Third-party API integration patterns and middleware architecture. Use when integrating Stripe, SendGrid, auth providers, webhooks, or building middleware chains. Covers webhook verification, retry patterns, caching strategies, and event-driven architecture."
---

# API Integration Guide

## Middleware Chain Pattern (Next.js)

```typescript
// src/middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const response = NextResponse.next();

  // Inject request ID for tracing
  response.headers.set('x-request-id', requestId);

  // Security headers
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

## Webhook Handler Pattern

```typescript
// src/app/api/webhooks/stripe/route.ts
import { headers } from 'next/headers';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get('stripe-signature')!;

  // 1. VERIFY SIGNATURE FIRST
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err) {
    console.error('Webhook signature verification failed');
    return new Response('Invalid signature', { status: 400 });
  }

  // 2. DEDUPLICATE (idempotency)
  const processed = await redis.get(`webhook:${event.id}`);
  if (processed) {
    return new Response('Already processed', { status: 200 });
  }

  // 3. PROCESS
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutComplete(event.data.object);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event.data.object);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    // 4. MARK AS PROCESSED
    await redis.set(`webhook:${event.id}`, '1', { ex: 86400 }); // 24h TTL
    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error(`Webhook processing failed: ${event.type}`, error);
    // Return 500 so Stripe retries
    return new Response('Processing failed', { status: 500 });
  }
}
```

## Stripe Integration Pattern

```typescript
// src/server/integrations/stripe.ts
import Stripe from 'stripe';
import { env } from '@/server/env';

export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
  typescript: true,
});

export async function createCheckoutSession(params: {
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
}) {
  return stripe.checkout.sessions.create({
    customer: params.customerId,
    line_items: [{ price: params.priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    allow_promotion_codes: true,
  });
}
```

## Caching Strategy

```typescript
// src/server/utils/cache.ts
import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export async function cached<T>(
  key: string,
  fn: () => Promise<T>,
  ttlSeconds: number = 300
): Promise<T> {
  const existing = await redis.get<T>(key);
  if (existing) return existing;

  const result = await fn();
  await redis.set(key, result, { ex: ttlSeconds });
  return result;
}

// Usage
const user = await cached(`user:${id}`, () => userService.findById(id), 600);
```

## Event-Driven Pattern (BullMQ)

```typescript
// src/jobs/queue.ts
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const connection = new Redis(process.env.REDIS_URL!);

// Define queues
export const emailQueue = new Queue('email', { connection });
export const analyticsQueue = new Queue('analytics', { connection });

// Dispatch events
export async function dispatchEvent(queue: Queue, event: string, data: any) {
  await queue.add(event, data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

// Worker
new Worker('email', async (job) => {
  switch (job.name) {
    case 'welcome': await sendWelcomeEmail(job.data); break;
    case 'reset-password': await sendResetEmail(job.data); break;
  }
}, { connection, concurrency: 5 });
```

## SEO Metadata Pattern

```typescript
// src/app/products/[id]/page.tsx
import type { Metadata } from 'next';

export async function generateMetadata({ params }): Promise<Metadata> {
  const product = await getProduct(params.id);
  return {
    title: `${product.name} | YourApp`,
    description: product.description.slice(0, 155),
    openGraph: {
      title: product.name,
      description: product.description,
      images: [{ url: product.image, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image' },
    alternates: { canonical: `https://yourapp.com/products/${params.id}` },
  };
}
```
