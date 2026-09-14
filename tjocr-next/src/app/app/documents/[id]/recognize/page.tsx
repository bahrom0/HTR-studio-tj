'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  RotateCw,
  Clock,
  Layers,
} from 'lucide-react';
import { useLocale } from '@/components/app-shell';
import { StepHeader } from '@/components/ui/step-header';
import { Button } from '@/components/ui/button';
import { Status } from '@/components/ui/status';
import { JobDto, LineResultDto, RegionDto } from '@/domain/types';
import { LineCropPreview } from '@/components/document/line-crop-preview';

export default function RecognizePage() {
  const { dictionary: t } = useLocale();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const documentId = params.id;

  const [documentData, setDocumentData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [job, setJob] = useState<JobDto | null>(null);
  const [lineResults, setLineResults] = useState<LineResultDto[]>([]);
  const [regions, setRegions] = useState<RegionDto[]>([]);
  const [isStarting, setIsStarting] = useState(false);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Fetch document and initial regions
  const loadInitialData = useCallback(async () => {
    try {
      setLoading(true);
      setPageError(null);

      const res = await fetch(`/api/v1/documents/${documentId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Document not found');
      const data = await res.json();
      setDocumentData(data);

      if (data.page?.id) {
        // Fetch confirmed regions for this page
        const regRes = await fetch(`/api/v1/pages/${data.page.id}/regions`, { cache: 'no-store' });
        if (regRes.ok) {
          const regData = await regRes.json();
          const sorted = [...(regData.regions || [])].sort((a: RegionDto, b: RegionDto) => a.readingOrder - b.readingOrder);
          setRegions(sorted);
        }
      }
    } catch (err: any) {
      setPageError(err.message || 'Ошибка загрузки документа');
    } finally {
      setLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // 2. Fetch line results for document
  const fetchLineResults = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/documents/${documentId}/line-results`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setLineResults(data.lineResults || []);
      }
    } catch {
      // Ignored during polling
    }
  }, [documentId]);

  // 3. Start or resume recognition job
  const startOrResumeJob = useCallback(async (pageId: string) => {
    try {
      setIsStarting(true);
      const res = await fetch(`/api/v1/pages/${pageId}/recognition-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error?.messageKey || 'Не удалось запустить распознавание');
      }

      const data = await res.json();
      if (data.jobId) {
        // Fetch full job status
        const jobRes = await fetch(`/api/v1/jobs/${data.jobId}`, { cache: 'no-store' });
        if (jobRes.ok) {
          const jobData = await jobRes.json();
          setJob(jobData.job);
        }
      } else if (data.job) {
        setJob(data.job);
      }
    } catch (err: any) {
      setPageError(err.message || 'Ошибка при запуске задачи распознавания');
    } finally {
      setIsStarting(false);
    }
  }, []);

  useEffect(() => {
    if (documentData?.page?.id && !job && !pageError && !isStarting) {
      startOrResumeJob(documentData.page.id);
    }
  }, [documentData?.page?.id, job, pageError, isStarting, startOrResumeJob]);

  // 4. Poll active job status
  useEffect(() => {
    if (!job?.id) return;
    const isTerminal = ['succeeded', 'partial', 'failed', 'cancelled'].includes(job.status);

    if (isTerminal) {
      fetchLineResults();
      return;
    }

    pollTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/jobs/${job.id}`, { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          if (data.job) {
            setJob(data.job);
            fetchLineResults();
          }
        }
      } catch {
        // Keep polling
      }
    }, 1200);

    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [job, fetchLineResults]);

  if (loading) {
    return (
      <div className="document-page">
        <section className="page-width py-12">
          <Status variant="loading">{t.common.loading}</Status>
        </section>
      </div>
    );
  }

  if (pageError || !documentData) {
    return (
      <div className="document-page">
        <section className="page-width py-12">
          <p className="text-sm text-status-danger mb-4">{pageError || t.document.notFound}</p>
          <Link href="/app" className="text-action text-action--back">
            {t.document.back}
          </Link>
        </section>
      </div>
    );
  }

  const { document: doc, page, previewUrl } = documentData;
  const totalLines = job?.totalCount || regions.length || 0;
  const completedLines = job?.completedCount || 0;
  const failedLines = job?.failedCount || 0;
  const processedLines = completedLines + failedLines;
  const progressPercent = totalLines > 0 ? Math.min(100, Math.round((processedLines / totalLines) * 100)) : 0;
  const isFinished = job && ['succeeded', 'partial'].includes(job.status);
  const isFailed = job?.status === 'failed';

  return (
    <div className="flex flex-col min-h-screen bg-background text-app-text">
      <StepHeader
        documentTitle={doc.title}
        currentStep={4}
        documentId={doc.id}
        stepLabel={t.document.recognizeStep}
        backHref={`/app/documents/${doc.id}/lines`}
        backLabel={t.document.backToLines}
        fullWidth={true}
      />

      <main className="flex-1 page-width py-6 md:py-8 flex flex-col gap-6 max-w-4xl mx-auto w-full">
        {/* Progress Card */}
        <div className="bg-surface border border-border rounded-xl p-5 md:p-6 shadow-sm flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {isFinished ? (
                <div className="w-10 h-10 rounded-full bg-status-success/15 text-status-success flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
              ) : isFailed ? (
                <div className="w-10 h-10 rounded-full bg-status-danger/15 text-status-danger flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-full bg-primary-bg/10 text-primary-bg dark:text-white flex items-center justify-center shrink-0">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              )}
              <div>
                <h1 className="text-lg md:text-xl font-semibold m-0 flex items-center gap-2">
                  <span>
                    {isFinished
                      ? job?.status === 'partial'
                        ? t.document.recognizePartial
                        : t.document.recognizeCompleted
                      : isFailed
                      ? t.document.recognizeFailed
                      : t.document.recognizingProgress}
                  </span>
                </h1>
                <p className="text-xs md:text-sm text-app-text-secondary m-0 mt-0.5">
                  {t.document.recognizingSubtitle}
                </p>
              </div>
            </div>

            {/* Quick action button in header */}
            {isFinished && (
              <Button
                variant="primary"
                size="md"
                className="self-start sm:self-auto shrink-0 font-medium"
                onClick={() => router.push(`/app/documents/${doc.id}/result`)}
              >
                <span>{t.document.openResultAction}</span>
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            )}

            {isFailed && (
              <Button
                variant="outline"
                size="md"
                className="self-start sm:self-auto shrink-0"
                onClick={() => page?.id && startOrResumeJob(page.id)}
              >
                <RotateCw className="w-4 h-4 mr-1.5" />
                <span>{t.common.retry}</span>
              </Button>
            )}
          </div>

          {/* Progress Bar and Counters */}
          <div className="space-y-2 pt-2 border-t border-border/60">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-app-text-secondary">
                {completedLines} / {totalLines} {t.document.linesRecognizedCount.toLowerCase()}
              </span>
              <span className="font-mono font-medium text-app-text">{progressPercent}%</span>
            </div>

            <div className="w-full h-2.5 bg-surface-hover rounded-full overflow-hidden border border-border/40">
              <div
                className="h-full bg-primary-bg transition-all duration-300 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Lines Processed List */}
        <div className="bg-surface border border-border rounded-xl p-4 md:p-6 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-app-text-secondary" />
              <h2 className="text-sm font-semibold m-0">{t.document.allLines}</h2>
              <span className="text-xs px-1.5 py-0.2 bg-surface-hover text-app-text-secondary rounded-full font-mono">
                {totalLines}
              </span>
            </div>

            <div className="text-xs text-app-text-secondary flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-status-success inline-block" />
                {completedLines} {t.document.lineStatusSuccess}
              </span>
              {failedLines > 0 && (
                <span className="inline-flex items-center gap-1 text-status-danger">
                  <span className="w-2 h-2 rounded-full bg-status-danger inline-block" />
                  {failedLines} {t.document.lineStatusFailed}
                </span>
              )}
            </div>
          </div>

          {totalLines === 0 ? (
            <div className="p-8 text-center text-xs text-app-text-secondary">
              {t.document.noLinesToRecognize}
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1">
              {regions.map((region, index) => {
                const res = lineResults.find((r) => r.regionId === region.id);
                const isLineSuccess = res && res.status === 'succeeded';
                const isLineFailed = res && res.status === 'failed';
                const isLineProcessing = !res && index === processedLines;
                const isLinePending = !res && index > processedLines;

                return (
                  <div
                    key={region.id}
                    className="p-3 rounded-lg border border-border bg-background flex flex-col md:flex-row items-start md:items-center justify-between gap-3 hover:border-border/80 transition-colors"
                  >
                    {/* Left: Badge, Crop preview */}
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-surface text-app-text font-mono text-[11px] font-semibold shrink-0 border border-border">
                        {index + 1}
                      </div>

                      <div className="w-28 md:w-36 h-10 rounded border border-border/70 overflow-hidden bg-black/40 flex items-center justify-center shrink-0">
                        {previewUrl ? (
                          <LineCropPreview
                            imageUrl={previewUrl}
                            imageWidth={page?.width || 2048}
                            imageHeight={page?.height || 2048}
                            geometry={region.geometry}
                          />
                        ) : (
                          <span className="text-[10px] text-app-text-secondary">Скан</span>
                        )}
                      </div>

                      {/* Line Text or placeholder */}
                      <div className="min-w-0 flex-1">
                        {isLineSuccess ? (
                          <p className="text-xs md:text-sm font-medium text-app-text leading-snug m-0 break-words font-sans">
                            {res.rawText || <span className="text-app-text-secondary italic">Пустая строка</span>}
                          </p>
                        ) : isLineFailed ? (
                          <p className="text-xs text-status-danger m-0">
                            {t.document.lineStatusFailed}
                          </p>
                        ) : isLineProcessing ? (
                          <div className="flex items-center gap-1.5 text-xs text-app-text-secondary">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>{t.document.lineStatusProcessing}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-app-text-secondary opacity-60">
                            {t.document.lineStatusPending}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status badge */}
                    <div className="shrink-0 self-end md:self-auto">
                      {isLineSuccess ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-status-success/10 text-status-success font-medium">
                          <CheckCircle2 className="w-3 h-3" />
                          {t.document.lineStatusSuccess}
                        </span>
                      ) : isLineFailed ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-status-danger/10 text-status-danger font-medium">
                          <AlertCircle className="w-3 h-3" />
                          {t.document.lineStatusFailed}
                        </span>
                      ) : isLineProcessing ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-primary-bg/10 text-app-text font-medium">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {t.document.lineStatusProcessing}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-surface-hover text-app-text-secondary">
                          <Clock className="w-3 h-3" />
                          {t.document.lineStatusPending}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Navigation */}
        <div className="flex items-center justify-between pt-2">
          <Link
            href={`/app/documents/${doc.id}/lines`}
            className="text-xs text-app-text-secondary hover:text-app-text transition-colors"
          >
            ← {t.document.backToLines}
          </Link>

          {isFinished && (
            <Button
              variant="primary"
              size="lg"
              className="font-medium"
              onClick={() => router.push(`/app/documents/${doc.id}/result`)}
            >
              <span>{t.document.openResultAction}</span>
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
