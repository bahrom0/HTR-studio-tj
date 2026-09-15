'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@/components/app-shell';

export function LandingPage() {
  const { dictionary: t } = useLocale();

  return (
    <div className="landing-page">
      <section className="landing-hero page-width" aria-labelledby="landing-title">
        <div className="landing-copy">
          <p className="eyebrow landing-eyebrow">{t.landing.kicker}</p>
          <h1 id="landing-title">{t.landing.title}</h1>
        </div>

        <div className="landing-summary">
          <p className="landing-description">{t.landing.description}</p>
          <div className="landing-actions">
            <Link className="button button--primary button--large" href="/app">
              {t.landing.start}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
            <a className="text-action" href="#process">
              {t.landing.secondaryAction}
              {/* <span aria-hidden="true">↓</span> */}
            </a>
          </div>
        </div>

        <ol className="landing-path" id="process" aria-label={t.landing.stepsTitle}>
          {[
            [t.landing.step1Title, t.landing.step1Desc],
            [t.landing.step2Title, t.landing.step2Desc],
            [t.landing.step3Title, t.landing.step3Desc],
          ].map(([title, description], index) => (
            <li className="landing-path__item" key={title}>
              <span className="landing-path__number">0{index + 1}</span>
              <div>
                <h2>{title}</h2>
                <p>{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
