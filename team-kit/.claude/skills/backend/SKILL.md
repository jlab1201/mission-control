---
name: backend-architecture
description: "Backend architecture patterns and best practices for Node.js/TypeScript APIs. Use when designing database schemas, API routes, service layers, authentication, validation, or any server-side architecture. Covers Prisma/Drizzle ORM patterns, Zod validation, layered architecture, and security defaults."
---

# Backend Architecture Guide

## Layered Architecture Pattern

```
Request → Middleware → Route Handler → Controller → Service → Repository → Database
                                                                    ↓
Response ← Middleware ← Route Handler ← Controller ← Service ← Repository
```

### Layer Responsibilities

**Route Handler** (`src/app/api/*/route.ts`): HTTP concerns only — parse request, call controller, return response. No business logic.

**Controller** (optional, for complex APIs): Orchestrates multiple services. Handles request validation via Zod.

**Service** (`src/server/services/*.ts`): Business logic. Pure functions where possible. No HTTP concepts (no `req`/`res`). Throws domain errors.

**Repository** (`src/server/repositories/*.ts`): Data access only. Prisma/Drizzle queries. Returns domain objects, not ORM objects.

## Database Schema Design

### Prisma Pattern
```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String?
  role      Role     @default(USER)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  deletedAt DateTime? @map("deleted_at")

  posts     Post[]
  sessions  Session[]

  @@map("users")
  @@index([email])
  @@index([deletedAt])
}

enum Role {
  USER
  ADMIN
  EDITOR
}
```

### Migration Workflow
```bash
# Create migration from schema changes
pnpm prisma migrate dev --name add_users_table

# Apply in production
pnpm prisma migrate deploy

# Reset (dev only)
pnpm prisma migrate reset
```

## API Route Pattern (Next.js App Router)

```typescript
// src/app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createUserSchema } from '@/server/validators/user';
import { userService } from '@/server/services/user.service';
import { withAuth } from '@/server/middleware/auth';
import { ApiError } from '@/server/utils/errors';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = createUserSchema.parse(body);
    const user = await userService.create(data);
    return NextResponse.json({ data: user }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.flatten().fieldErrors }
      }, { status: 422 });
    }
    if (error instanceof ApiError) {
      return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
    }
    return NextResponse.json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } }, { status: 500 });
  }
}
```

## Zod Validation (Shared with Frontend)

```typescript
// src/types/user.ts — shared between frontend and backend
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  role: z.enum(['USER', 'ADMIN', 'EDITOR']).default('USER'),
});

export const updateUserSchema = createUserSchema.partial();

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
```

## Error Handling Pattern

```typescript
// src/server/utils/errors.ts
export class ApiError extends Error {
  constructor(
    public code: string,
    public message: string,
    public status: number = 400,
    public details?: Record<string, string[]>
  ) {
    super(message);
  }

  static notFound(resource: string) {
    return new ApiError('NOT_FOUND', `${resource} not found`, 404);
  }

  static unauthorized() {
    return new ApiError('UNAUTHORIZED', 'Authentication required', 401);
  }

  static forbidden() {
    return new ApiError('FORBIDDEN', 'Insufficient permissions', 403);
  }

  static conflict(message: string) {
    return new ApiError('CONFLICT', message, 409);
  }
}
```

## Authentication Pattern

```typescript
// src/server/middleware/auth.ts
import { NextRequest } from 'next/server';
import { verifyToken } from '@/server/services/auth.service';

export async function withAuth(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) throw ApiError.unauthorized();

  const payload = await verifyToken(token);
  if (!payload) throw ApiError.unauthorized();

  return payload; // { userId, role, ... }
}

export async function requireRole(req: NextRequest, ...roles: Role[]) {
  const user = await withAuth(req);
  if (!roles.includes(user.role)) throw ApiError.forbidden();
  return user;
}
```

## Environment Validation

```typescript
// src/server/env.ts — validates ALL env vars at startup
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
});

export const env = envSchema.parse(process.env);
```
