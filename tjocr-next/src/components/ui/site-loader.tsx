'use client';

import { useLocale } from '@/components/app-shell';

type SiteLoaderProps = {
  label?: string;
  className?: string;
};

/** Centered route/data loader that uses the same TJOCR mark as the splash. */
export function SiteLoader({ label, className = '' }: Readonly<SiteLoaderProps>) {
  const { theme, dictionary: t } = useLocale();
  const loadingLabel = label || t.common.loading;

  return (
    <div className={`site-loader ${className}`} role="status" aria-live="polite" aria-label={loadingLabel}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={theme === 'dark' ? '/logo-dark.png' : '/logo-light.png'}
        alt=""
        aria-hidden="true"
        className="site-loader__logo"
      />
      <div className="site-loader__track" aria-hidden="true">
        <span className="site-loader__bar" />
      </div>
      <span className="sr-only">{loadingLabel}</span>
    </div>
  );
}
