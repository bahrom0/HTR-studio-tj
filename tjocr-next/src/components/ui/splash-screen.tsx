'use client';

import React, { useEffect, useState } from 'react';
import { useLocale } from '@/components/app-shell';

interface SplashScreenProps {
  /** Minimum duration in ms to show the splash before fading out */
  minDisplayMs?: number;
  /** Duration of fade out transition in ms */
  fadeDurationMs?: number;
  /** Logo variant: solid (default) or outline */
  variant?: 'solid' | 'outline';
}

export function SplashScreen({
  minDisplayMs = 700,
  fadeDurationMs = 550,
  variant = 'solid',
}: Readonly<SplashScreenProps>) {
  const { theme } = useLocale();
  const [phase, setPhase] = useState<'visible' | 'fading' | 'hidden'>('visible');

  useEffect(() => {
    // Only show on initial load in browser session
    const shownInSession = window.sessionStorage?.getItem('tjocr_splash_shown');
    if (shownInSession) {
      setPhase('hidden');
      return;
    }

    const fadeTimer = setTimeout(() => {
      setPhase('fading');
      try {
        window.sessionStorage?.setItem('tjocr_splash_shown', 'true');
      } catch {
        // Ignore storage errors in privacy mode
      }

      const hideTimer = setTimeout(() => {
        setPhase('hidden');
      }, fadeDurationMs);

      return () => clearTimeout(hideTimer);
    }, minDisplayMs);

    return () => clearTimeout(fadeTimer);
  }, [minDisplayMs, fadeDurationMs]);

  if (phase === 'hidden') return null;

  const isFading = phase === 'fading';

  // Determine logo source based on theme and chosen variant
  let logoSrc = '/logo-light.png';
  if (variant === 'outline') {
    logoSrc = theme === 'dark' ? '/logo-outline-dark.png' : '/logo-outline.png';
  } else {
    logoSrc = theme === 'dark' ? '/logo-dark.png' : '/logo-light.png';
  }

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[99999] flex flex-col items-center justify-center bg-background select-none pointer-events-none transition-all ${
        isFading ? 'opacity-0 scale-[0.98]' : 'opacity-100 scale-100'
      }`}
      style={{
        transitionDuration: `${fadeDurationMs}ms`,
        transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      <div
        className={`flex flex-col items-center justify-center gap-8 transition-transform ${
          isFading ? 'scale-[0.96]' : 'scale-100'
        }`}
        style={{
          transitionDuration: `${fadeDurationMs}ms`,
          transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Centered TJOCR Logo */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoSrc}
          alt="TJOCR"
          className="w-44 sm:w-52 h-auto object-contain select-none drop-shadow-sm"
        />

        {/* Windows 11 Continuous / Indeterminate Loader */}
        <div className="win11-loader" role="progressbar" aria-label="Загрузка...">
          <div className="win11-loader__bar" />
        </div>
      </div>
    </div>
  );
}
