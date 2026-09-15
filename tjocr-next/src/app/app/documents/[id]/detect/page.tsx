'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, CheckCircle2, AlertCircle, RefreshCw, PenTool } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useLocale } from '@/components/app-shell';
import { StepHeader } from '@/components/ui/step-header';
import { Button } from '@/components/ui/button';
import { Status } from '@/components/ui/status';
import { SiteLoader } from '@/components/ui/site-loader';
import { CachedImage } from '@/components/ui/cached-image';
import { LineOverlay } from '@/components/document/line-overlay';
import { RegionDto } from '@/domain/types';

type DocumentDetails = {
  document: {
    id: string;
    title: string;
    state: string;
    bytes: number;
    version: number;
  };
  page: {
    id: string;
    documentId: string;
    width: number;
    height: number;
    imageRevision: number;
  } | null;
  previewUrl: string | null;
};

export default function DocumentDetectPage() {
  const { dictionary: t } = useLocale();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [details, setDetails] = useState<DocumentDetails | null>(null);
  const [regions, setRegions] = useState<RegionDto[]>([]);
  const [hasRevision, setHasRevision] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRetrying, setIsRetrying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);

  const fetchState = async () => {
    try {
      const docRes = await fetch(`/api/v1/documents/${params.id}`, { cache: 'no-store' });
      if (!docRes.ok) throw new Error('Document not found');
      const docData = (await docRes.json()) as DocumentDetails;
      setDetails(docData);

      if (docData.page?.id) {
        const regRes = await fetch(`/api/v1/pages/${docData.page.id}/regions`, { cache: 'no-store' });
        if (regRes.ok) {
          const regData = await regRes.json();
          if (regData.revision) {
            setHasRevision(true);
            setRegions(regData.regions || []);
          }
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Error loading document');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
  }, [params.id]);

  // Polling while detecting
  useEffect(() => {
    if (!details || details.document.state !== 'detecting') return;

    const interval = setInterval(async () => {
      await fetchState();
    }, 2000);

    return () => clearInterval(interval);
  }, [details?.document.state]);

  const handleRetry = async () => {
    if (!details?.page?.id || isRetrying) return;
    setIsRetrying(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/v1/pages/${details.page.id}/detection-jobs`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to restart detection');
      await fetchState();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Не удалось повторить поиск строк');
    } finally {
      setIsRetrying(false);
    }
  };

  if (isLoading) {
    return <SiteLoader />;
  }

  if (!details) {
    return (
      <div className="document-page">
        <section className="page-width py-12">
          <p className="text-sm text-status-danger mb-4">{t.document.notFound}</p>
          <Link className="text-action text-action--back" href="/app">
            <ArrowLeft aria-hidden="true" size={15} />
            {t.document.back}
          </Link>
        </section>
      </div>
    );
  }

  const { document: doc, page, previewUrl } = details;
  const isDetecting = doc.state === 'detecting';
  const isFailed = doc.state === 'failed' || (!isDetecting && !hasRevision && doc.state === 'uploaded');
  const isReady = hasRevision || doc.state === 'lines_ready';
  const lineCount = regions.length;

  return (
    <div className="document-page">
      <StepHeader
        documentTitle={doc.title}
        currentStep={2}
        documentId={doc.id}
        stepLabel={t.document.detectStep}
        backHref={`/app/documents/${doc.id}/upload`}
        backLabel={t.document.backToUpload}
        status={
          isDetecting ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium bg-surface text-app-text-secondary border border-border">
              <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
              <span className="hidden sm:inline">{t.document.detecting}</span>
            </span>
          ) : isReady && lineCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 rounded text-[11px] font-medium bg-surface text-status-success border border-border">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success shrink-0" />
              <span>{lineCount}</span>
              <span className="hidden sm:inline">{t.document.linesFound.toLowerCase()}</span>
            </span>
          ) : undefined
        }
      />

      <section className="page-width py-5 max-w-5xl mx-auto" aria-labelledby="detect-screen-title">
        {errorMessage ? (
          <div className="mb-4">
            <Status variant="danger">{errorMessage}</Status>
          </div>
        ) : null}

        {/* 1. Detecting Pending / Running State */}
        {isDetecting ? (
          <div className="flex flex-col items-center justify-center p-8 sm:p-12 border border-border bg-surface rounded-lg text-center gap-4">
            <Status variant="loading" className="text-sm font-medium">
              {t.document.detecting}
            </Status>
            <p className="text-xs text-app-text-secondary max-w-md">
              {t.document.detectingHint}
            </p>
            {previewUrl ? (
              <div className="mt-4 max-w-sm opacity-60 rounded border border-border overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <CachedImage src={previewUrl} alt={doc.title} className="w-full h-auto object-contain" />
              </div>
            ) : null}
            <div className="mt-2">
              <Link
                href={`/app/documents/${doc.id}/lines`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-app-text-secondary hover:text-app-text hover:bg-surface-hover border border-border transition-colors"
                title={t.document.manualAnnotate}
              >
                <PenTool className="w-3.5 h-3.5" />
                <span>{t.document.manualAnnotate}</span>
              </Link>
            </div>
          </div>
        ) : null}

        {/* 2. Detected Lines Ready (lineCount > 0) */}
        {!isDetecting && isReady && lineCount > 0 ? (
          <div className="flex flex-col gap-6">
            {/* Status notification */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 rounded-md border border-border bg-surface">
              <div className="flex items-center gap-2 text-sm font-medium text-app-text">
                <CheckCircle2 className="w-4 h-4 text-status-success shrink-0" />
                <span>
                  {t.document.linesFound}: <strong>{lineCount}</strong>
                </span>
                <span className="text-xs text-app-text-secondary ml-2 font-normal hidden sm:inline">
                  {t.document.linesFoundDesc}
                </span>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRetry}
                  disabled={isRetrying}
                  title={t.document.retryDetection}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  {t.document.retryDetection}
                </Button>
              </div>
            </div>

            {/* Interactive Preview Canvas with Detected Boxes */}
            {previewUrl && page ? (
              <div className="max-w-4xl mx-auto w-full overflow-hidden">
                <LineOverlay
                  imageUrl={previewUrl}
                  imageWidth={page.width}
                  imageHeight={page.height}
                  regions={regions}
                  selectedRegionId={selectedRegionId}
                  onSelectRegion={(id) => setSelectedRegionId(id)}
                />
              </div>
            ) : null}

            {/* Primary Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border pt-4">
              <span className="text-xs text-app-text-secondary">
                {lineCount} {t.document.linesFound.toLowerCase()}
              </span>
              <Button
                variant="primary"
                size="lg"
                className="w-full sm:w-auto"
                onClick={() => router.push(`/app/documents/${doc.id}/lines`)}
              >
                {t.document.reviewLines}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        ) : null}

        {/* 3. Zero Lines Found State */}
        {!isDetecting && isReady && lineCount === 0 ? (
          <div className="flex flex-col items-center justify-center p-10 border border-border bg-surface rounded-lg text-center gap-4">
            <Status variant="info" className="text-sm font-medium">
              {t.document.zeroLines}
            </Status>
            <p className="text-xs text-app-text-secondary max-w-md">
              Алгоритм не обнаружил явных строк текста. Вы можете перейти в редактор и разметить строки вручную.
            </p>
            {previewUrl ? (
              <div className="max-w-xs rounded border border-border overflow-hidden my-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <CachedImage src={previewUrl} alt={doc.title} className="w-full h-auto object-contain" />
              </div>
            ) : null}
            <div className="flex items-center gap-3 mt-2">
              <Button
                variant="primary"
                size="md"
                onClick={() => router.push(`/app/documents/${doc.id}/lines`)}
              >
                <PenTool className="w-4 h-4 mr-1.5" />
                {t.document.manualAnnotate}
              </Button>
              <Button
                variant="outline"
                size="md"
                onClick={handleRetry}
                isLoading={isRetrying}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                {t.document.retryDetection}
              </Button>
            </div>
          </div>
        ) : null}

        {/* 4. Failed Detection State */}
        {!isDetecting && isFailed ? (
          <div className="flex flex-col items-center justify-center p-10 border border-border bg-surface rounded-lg text-center gap-4">
            <div className="flex items-center gap-2 text-status-danger text-sm font-medium">
              <AlertCircle className="w-5 h-5" />
              <span>{t.document.detectionFailed}</span>
            </div>
            <p className="text-xs text-app-text-secondary max-w-md">
              Произошла ошибка при обращении к сервису детекции. Вы можете повторить попытку или перейти к ручной разметке строк.
            </p>
            <div className="flex items-center gap-3 mt-2">
              <Button
                variant="primary"
                size="md"
                onClick={handleRetry}
                isLoading={isRetrying}
              >
                <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                {t.document.retryDetection}
              </Button>
              <Button
                variant="outline"
                size="md"
                onClick={() => router.push(`/app/documents/${doc.id}/lines`)}
              >
                <PenTool className="w-4 h-4 mr-1.5" />
                {t.document.manualAnnotate}
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
