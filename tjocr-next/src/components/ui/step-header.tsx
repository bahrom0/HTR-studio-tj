'use client';

import Link from 'next/link';
import { ArrowLeft, Check } from 'lucide-react';
import React from 'react';
import { Brand, LocaleAndThemeControls, useLocale } from '@/components/app-shell';

export type StepNumber = 1 | 2 | 3 | 4 | 5;

export interface StepHeaderProps {
  documentTitle: string;
  currentStep?: StepNumber;
  totalSteps?: number;
  documentId?: string;
  stepLabel?: string;
  backHref?: string;
  backLabel?: string;
  status?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  fullWidth?: boolean;
}

interface StepItem {
  number: StepNumber;
  nameKey: 'step1Name' | 'step2Name' | 'step3Name' | 'step4Name' | 'step5Name';
  slug: string;
}

const STEPS: StepItem[] = [
  { number: 1, nameKey: 'step1Name', slug: 'upload' },
  { number: 2, nameKey: 'step2Name', slug: 'detect' },
  { number: 3, nameKey: 'step3Name', slug: 'lines' },
  { number: 4, nameKey: 'step4Name', slug: 'recognize' },
  { number: 5, nameKey: 'step5Name', slug: 'result' },
];

export function StepHeader({
  documentTitle,
  currentStep = 1,
  totalSteps = 5,
  documentId,
  stepLabel,
  backHref = '/app',
  backLabel,
  status,
  actions,
  children,
  fullWidth = true,
}: Readonly<StepHeaderProps>) {
  const { dictionary: t } = useLocale();

  const currentStepItem = STEPS.find((s) => s.number === currentStep) || STEPS[0];
  const currentStepName = t.document[currentStepItem.nameKey];

  return (
    <header className={`step-header ${fullWidth ? 'step-header--full' : ''}`} aria-label="Панель этапа документа">
      <div className="step-header__inner">
        {/* Left Section: Brand Logo + Back button + Title */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 min-w-0 flex-1 max-w-full">
          {/* Compact Brand Logo */}
          <Brand compact />

          <span className="h-4 w-px bg-border shrink-0" aria-hidden="true" />

          {/* Back Navigation Button */}
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-1 text-xs font-medium text-app-text-secondary hover:text-app-text hover:bg-surface-hover rounded transition-colors border border-transparent hover:border-border shrink-0"
            title={backLabel || t.document.backShort}
            aria-label={backLabel || t.document.backShort}
          >
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{backLabel || t.document.backShort}</span>
          </Link>

          {/* Divider */}
          <span className="h-4 w-px bg-border shrink-0" aria-hidden="true" />

          {/* Document Title: flexible with min-w-0 to prevent overflow while showing maximum filename */}
          <span
            className="text-xs sm:text-sm font-medium text-app-text truncate min-w-0 flex-shrink"
            title={documentTitle}
          >
            {documentTitle}
          </span>

          {/* Desktop 5-Step Progress (>= 1024px) */}
          <nav aria-label="Этапы обработки" className="hidden lg:flex items-center gap-1.5 ml-2 border-l border-border pl-3 shrink-0">
            {STEPS.map((step, idx) => {
              const isCurrent = step.number === currentStep;
              const isPassed = step.number < currentStep;
              const isAccessible = Boolean(documentId && (step.number <= currentStep || isPassed));
              const stepName = t.document[step.nameKey];
              const stepUrl = documentId ? `/app/documents/${documentId}/${step.slug}` : undefined;

              return (
                <React.Fragment key={step.number}>
                  {idx > 0 && <span className="text-app-text-secondary/30 text-[10px] select-none">/</span>}
                  {isCurrent ? (
                    <span
                      aria-current="step"
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-app-text bg-surface border border-border"
                    >
                      <span className="w-4 h-4 rounded-full bg-primary-bg text-primary-text flex items-center justify-center text-[10px] font-bold">
                        {step.number}
                      </span>
                      <span>{stepName}</span>
                    </span>
                  ) : isAccessible && stepUrl ? (
                    <Link
                      href={stepUrl}
                      className="flex items-center gap-1.5 px-1.5 py-0.5 rounded text-xs text-app-text-secondary hover:text-app-text hover:bg-surface transition-colors"
                      title={stepName}
                    >
                      <span
                        className={`w-4 h-4 rounded-full bg-surface border border-border flex items-center justify-center text-[10px] ${
                          isPassed ? 'text-status-success font-semibold' : 'text-app-text-secondary'
                        }`}
                      >
                        {isPassed ? <Check className="w-2.5 h-2.5 stroke-[2.5]" /> : step.number}
                      </span>
                      <span>{stepName}</span>
                    </Link>
                  ) : (
                    <span className="flex items-center gap-1.5 px-1.5 py-0.5 text-xs text-app-text-secondary/40 select-none">
                      <span className="w-4 h-4 rounded-full border border-border/60 text-app-text-secondary/40 flex items-center justify-center text-[10px]">
                        {step.number}
                      </span>
                      <span>{stepName}</span>
                    </span>
                  )}
                </React.Fragment>
              );
            })}
          </nav>

          {/* Tablet Step Pill (640px - 1023px) */}
          <div className="hidden sm:flex lg:hidden items-center ml-1 shrink-0">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface border border-border text-[11px] font-mono text-app-text-secondary whitespace-nowrap">
              {stepLabel || `${t.document.stepPrefix} ${currentStep}/${totalSteps} · ${currentStepName}`}
            </span>
          </div>

          {/* Mobile Step Pill (< 640px): Ultra-compact pill so title is never crushed */}
          <div className="flex sm:hidden items-center ml-1 shrink-0">
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] font-mono text-app-text-secondary whitespace-nowrap"
              title={`${t.document.stepPrefix} ${currentStep}/${totalSteps} · ${currentStepName}`}
            >
              {currentStep}/{totalSteps}
            </span>
          </div>
        </div>

        {/* Right Section: Status, Actions, Home link & Locale/Theme */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-1.5 sm:ml-2">
          {status ? (
            typeof status === 'string' ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-surface border border-border text-[11px] font-mono text-app-text-secondary">
                {status}
              </span>
            ) : (
              status
            )
          ) : null}
          {actions}
          {children}

          <Link
            href="/app"
            className="hidden sm:inline-flex items-center px-2 py-1 rounded text-xs text-app-text-secondary hover:text-app-text hover:bg-surface-hover transition-colors"
            title={t.nav.home}
          >
            {t.nav.home}
          </Link>

          <LocaleAndThemeControls />
        </div>
      </div>
    </header>
  );
}
