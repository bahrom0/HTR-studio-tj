'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import { useLocale } from '@/components/app-shell';

const sampleRows = {
  ru: ['Здесь начинается история', 'текста, который можно сохранить.', 'Проверьте каждую строку.'],
  tg: ['Ин ҷо таърихи матн', 'оғоз мешавад.', 'Ҳар сатрро санҷед.'],
} as const;

export function LandingPage() {
  const { dictionary: t, locale } = useLocale();
  const [selectedLine, setSelectedLine] = useState(0);
  const lines = sampleRows[locale];

  return (
    <div className="landing-page">
      <section className="landing-hero page-width" aria-labelledby="landing-title">
        <div className="landing-copy">
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

        <figure className="sample-preview">
          <div className="sample-preview__header">
            <span className="sample-preview__label">
              <span className="status-dot status-dot--success" aria-hidden="true" />
              {t.landing.previewLabel}
            </span>
          </div>
          <div className="sample-preview__body">
            <div className="sample-paper" role="listbox" aria-label={t.landing.previewLinesLabel}>
              {lines.map((line, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedLine === index}
                  className={selectedLine === index ? 'sample-line sample-line--selected' : 'sample-line'}
                  key={line}
                  onClick={() => setSelectedLine(index)}
                >
                  <span className="sample-line__number">{String(index + 1).padStart(2, '0')}</span>
                  <span>{line}</span>
                </button>
              ))}
            </div>
            <div className="sample-result">
              <p className="sample-result__eyebrow">{t.landing.previewResultLabel}</p>
              <p className="sample-result__text">{lines[selectedLine]}</p>
              <p className="sample-result__caption">{t.landing.previewCaption}</p>
            </div>
          </div>
          <figcaption>{t.landing.previewNote}</figcaption>
        </figure>
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
