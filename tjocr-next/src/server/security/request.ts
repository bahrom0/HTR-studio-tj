import { NextResponse, type NextRequest } from 'next/server';

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly headers?: Record<string, string>;

  constructor(
    message: string,
    code: string,
    statusCode = 500,
    retryable = false,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.retryable = retryable;
    this.headers = headers;
  }
}

/** Reject cross-site state-changing browser requests while keeping CLI/API
 * clients that omit Origin usable for diagnostics and cron jobs. */
export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (!origin) return;

  let expectedOrigin = request.nextUrl.origin;
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.SUPABASE_APP_URL;
  if (configuredUrl) {
    try {
      expectedOrigin = new URL(configuredUrl).origin;
    } catch {
      // The request origin is the safest fallback when an optional URL is malformed.
    }
  }

  if (origin !== expectedOrigin && origin !== request.nextUrl.origin) {
    throw new HttpError('Недопустимый источник запроса.', 'CSRF_ORIGIN_MISMATCH', 403, false);
  }
}

export function getClientIp(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = request.headers.get('x-real-ip')?.trim();
  const value = forwarded || realIp || 'unknown';
  return value.slice(0, 128);
}

export function noStore(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0');
  response.headers.set('Vary', 'Cookie, Origin');
  return response;
}

export function jsonNoStore(data: unknown, init?: ResponseInit) {
  return noStore(NextResponse.json(data, init));
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    const response = jsonNoStore(
      {
        error: {
          code: error.code,
          messageKey: error.message,
          retryable: error.retryable,
        },
      },
      { status: error.statusCode },
    );
    Object.entries(error.headers || {}).forEach(([key, value]) => response.headers.set(key, value));
    return response;
  }

  console.error('[TJOCR API]', error);
  return jsonNoStore(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        messageKey: 'errors.internal',
        retryable: false,
      },
    },
    { status: 500 },
  );
}
