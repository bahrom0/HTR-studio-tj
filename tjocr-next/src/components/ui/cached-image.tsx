'use client';

import { useEffect, useState } from 'react';
import { resolveCachedImage } from '@/lib/image-cache';

type CachedImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  src: string | null | undefined;
  cacheKey?: string;
};

/** An image that keeps a stable, queryless Storage object in Cache Storage. */
export function CachedImage({ src, cacheKey, style, ...props }: Readonly<CachedImageProps>) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(Boolean(src));

  useEffect(() => {
    let disposed = false;
    let resource: Awaited<ReturnType<typeof resolveCachedImage>> | null = null;

    if (!src) {
      setResolvedSrc(null);
      setIsResolving(false);
      return () => {
        disposed = true;
      };
    }

    setResolvedSrc(null);
    setIsResolving(true);

    resolveCachedImage(src, cacheKey)
      .then((nextResource) => {
        resource = nextResource;
        if (disposed) {
          nextResource.revoke();
          return;
        }
        setResolvedSrc(nextResource.url);
        setIsResolving(false);
      })
      .catch(() => {
        // resolveCachedImage intentionally falls back to the signed URL, but
        // keep a direct fallback here for unexpected browser API failures.
        if (!disposed) {
          setResolvedSrc(src);
          setIsResolving(false);
        }
      });

    return () => {
      disposed = true;
      resource?.revoke();
    };
  }, [src, cacheKey]);

  return (
    <img
      {...props}
      src={resolvedSrc || undefined}
      data-tjocr-image-cache={isResolving ? 'loading' : 'ready'}
      style={{ ...style, visibility: isResolving ? 'hidden' : style?.visibility }}
    />
  );
}
