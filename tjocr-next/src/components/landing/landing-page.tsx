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
          <p className="landing-description">{t.landing.description}</p>
          <div className="landing-actions">
            <Link className="button button--primary button--large" href="/app">
              {t.landing.start}
              <ArrowRight aria-hidden="true" size={16} />
            </Link>
            <a className="text-action" href="#process">
              {t.landing.secondaryAction}
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>

        <aside className="landing-principle" aria-label={t.landing.principleTitle}>
          <p className="landing-principle__number" aria-hidden="true">01</p>
          <div>
            <h2>{t.landing.principleTitle}</h2>
            <p>{t.landing.principleDescription}</p>
          </div>
        </aside>
      </section>

      <section className="process-section page-width" id="process" aria-labelledby="process-title">
        <div className="process-intro">
          <h2 id="process-title">{t.landing.stepsTitle}</h2>
          <p>{t.landing.stepsDescription}</p>
        </div>
        <ol className="process-list">
          {[
            [t.landing.step1Title, t.landing.step1Desc],
            [t.landing.step2Title, t.landing.step2Desc],
            [t.landing.step3Title, t.landing.step3Desc],
          ].map(([title, description], index) => (
            <li className="process-item" key={title}>
              <span className="process-number">0{index + 1}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
