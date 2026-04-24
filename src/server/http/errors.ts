import { NextResponse } from 'next/server';
import type { ApiErrorResponse } from '@/types/index';

export function apiError(
  code: string,
  message: string,
  status: number,
  details?: unknown,
): NextResponse<ApiErrorResponse> {
  const body: ApiErrorResponse = {
    error: details === undefined ? { code, message } : { code, message, details },
  };
  return NextResponse.json(body, { status });
}
