'use client';

const IMAGE_CACHE_NAME = 'tjocr-image-cache-v1';
const IMAGE_CACHE_PREFIX = '/__tjocr_cached_images__/';
const inFlightBlobLoads = new Map<string, Promise<Blob>>();

export type CachedImageResource = {
  url: string;
  revoke: () => void;
};

/**
 * Signed Storage URLs contain a short-lived token in the query string. The
 * object path is stable, so it is the browser cache identity we keep.
 */
export function stableImageCacheKey(source: string) {
  const withoutQuery = source.split('?')[0];
  try {
    return new URL(withoutQuery, 'https://tjocr.invalid').pathname || withoutQuery;
  } catch {
    return withoutQuery;
  }
}

function getCacheRequest(cacheKey: string) {
  return new Request(
    `${window.location.origin}${IMAGE_CACHE_PREFIX}${encodeURIComponent(cacheKey)}`,
    { method: 'GET' },
  );
}

async function loadImageBlob(source: string, cacheKey: string) {
  if (!('caches' in window)) {
    const response = await fetch(source, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`Image request failed: HTTP ${response.status}`);
    return response.blob();
  }

  const cache = await window.caches.open(IMAGE_CACHE_NAME);
  const cacheRequest = getCacheRequest(cacheKey);
  const cachedResponse = await cache.match(cacheRequest);
  if (cachedResponse) return cachedResponse.blob();

  const response = await fetch(source, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`Image request failed: HTTP ${response.status}`);

  // Cache failures (private mode, quota limits) must not make the image fail.
  try {
    await cache.put(cacheRequest, response.clone());
  } catch {
    // The current response is still usable below.
  }

  return response.blob();
}

async function getImageBlob(source: string, cacheKey: string) {
  const existing = inFlightBlobLoads.get(cacheKey);
  if (existing) return existing;

  const request = loadImageBlob(source, cacheKey);
  inFlightBlobLoads.set(cacheKey, request);
  try {
    return await request;
  } finally {
    inFlightBlobLoads.delete(cacheKey);
  }
}

/** Resolve a signed image URL to a persistent browser-cache URL. */
export async function resolveCachedImage(
  source: string,
  cacheKey = stableImageCacheKey(source),
): Promise<CachedImageResource> {
  if (!source || typeof window === 'undefined') {
    return { url: source, revoke: () => undefined };
  }

  try {
    const blob = await getImageBlob(source, cacheKey);
    const objectUrl = URL.createObjectURL(blob);
    return {
      url: objectUrl,
      revoke: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    // Supabase Storage may be blocked by a browser privacy mode. Keep the
    // signed URL as a safe fallback so the existing image still renders.
    return { url: source, revoke: () => undefined };
  }
}

export async function invalidateCachedImage(sourceOrKey: string) {
  if (!sourceOrKey || typeof window === 'undefined' || !('caches' in window)) return;

  try {
    const cache = await window.caches.open(IMAGE_CACHE_NAME);
    await cache.delete(getCacheRequest(stableImageCacheKey(sourceOrKey)));
  } catch {
    // Cache invalidation is best effort; the server remains the source of truth.
  }
}

