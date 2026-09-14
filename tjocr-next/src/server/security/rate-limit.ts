import type { NextRequest } from 'next/server';
import { createAdminSupabaseClient } from '@/server/supabase/admin';
import { getClientIp, HttpError } from './request';

type MemoryBucket = { count: number; resetAt: number };

// This protects a warm serverless instance immediately. When a service key is
// configured, the database bucket below extends the same guard across
// instances and regions.
const memoryBuckets = new Map<string, MemoryBucket>();

function consumeMemory(key: string, limit: number, windowSeconds: number) {
  const now = Date.now();
  const current = memoryBuckets.get(key);
  const bucket = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + windowSeconds * 1000 }
    : current;

  bucket.count += 1;
  memoryBuckets.set(key, bucket);

  if (memoryBuckets.size > 2048) {
    for (const [entryKey, entry] of memoryBuckets) {
      if (entry.resetAt <= now) memoryBuckets.delete(entryKey);
    }
  }

  if (bucket.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw new HttpError(
      'Слишком много запросов. Попробуйте позже.',
      'RATE_LIMITED',
      429,
      true,
      { 'Retry-After': String(retryAfter) },
    );
  }
}

export async function enforceRateLimit(
  request: NextRequest,
  scope: string,
  limit: number,
  windowSeconds = 60,
) {
  const key = `${scope}:${getClientIp(request)}`;
  consumeMemory(key, limit, windowSeconds);

  // A durable bucket is optional for local development, but production can
  // enable it by supplying the server-only service key.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminSupabaseClient();
      const { data, error } = await admin.rpc('check_rate_limit', {
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (!error && data && data.allowed === false) {
        const retryAfter = Math.max(1, Math.ceil((new Date(data.resetAt).getTime() - Date.now()) / 1000));
        throw new HttpError(
          'Слишком много запросов. Попробуйте позже.',
          'RATE_LIMITED',
          429,
          true,
          { 'Retry-After': String(retryAfter) },
        );
      }
    } catch (error) {
      if (error instanceof HttpError) throw error;
      // A missing optional migration must not turn local auth into a 500; the
      // process-local limiter remains active until the migration is applied.
      console.warn('[TJOCR rate limit] durable bucket unavailable');
    }
  }
}
