'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, RotateCcw, RotateCw, ScanLine, RefreshCw, PenTool } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useLocale } from '@/components/app-shell';
import { StepHeader } from '@/components/ui/step-header';
import { Button } from '@/components/ui/button';
import { Status } from '@/components/ui/status';
import FileUpload05, { type FileUploadState } from '@/components/block/FileUpload/fileupload-05/fileupload';

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

export default function DocumentUploadPage() {
  const { dictionary: t } = useLocale();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [details, setDetails] = useState<DocumentDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isStartingDetection, setIsStartingDetection] = useState(false);
  const [detectionError, setDetectionError] = useState<string | null>(null);

  // File replacement state
  const [isReplacing, setIsReplacing] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadState, setUploadState] = useState<FileUploadState>('idle');

  const fetchDocument = async () => {
    try {
      const response = await fetch(`/api/v1/documents/${params.id}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Fetch failed');
      const data = (await response.json()) as DocumentDetails;
      setDetails(data);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDocument();
  }, [params.id]);

  const handleRotate = async (degrees: 90 | 270) => {
    if (!details || isRotating) return;
    setIsRotating(true);
    setDetectionError(null);

    try {
      const res = await fetch(`/api/v1/documents/${details.document.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rotate: degrees,
          expectedVersion: details.document.version,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.messageKey || 'Failed to rotate');
      }

      await fetchDocument();
    } catch (err) {
      setDetectionError(err instanceof Error ? err.message : 'Ошибка при повороте');
    } finally {
      setIsRotating(false);
    }
  };

  const handleStartDetection = async () => {
    if (!details?.page?.id || isStartingDetection) return;
    setIsStartingDetection(true);
    setDetectionError(null);

    try {
      const res = await fetch(`/api/v1/pages/${details.page.id}/detection-jobs`, {
        method: 'POST',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.messageKey || 'Failed to start detection');
      }

      router.push(`/app/documents/${details.document.id}/detect`);
    } catch (err) {
      setDetectionError(err instanceof Error ? err.message : 'Не удалось запустить поиск строк');
      setIsStartingDetection(false);
    }
  };

  const handleFilesChange = async (nextFiles: File[]) => {
    setFiles(nextFiles);
    const file = nextFiles[0];
    if (!file || !details) return;

    setUploadProgress(0);
    setUploadState('preparing');

    try {
      const createResponse = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: file.name, bytes: file.size }),
      });
      const createData = await createResponse.json();
      if (!createResponse.ok || !createData?.uploadUrl) throw new Error('Reservation failed');

      setUploadState('uploading');
      await fetch(createData.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });

      setUploadState('verifying');
      const completeRes = await fetch(`/api/v1/documents/${createData.document.id}/upload-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectKey: createData.objectKey,
          mime: file.type,
          bytes: file.size,
        }),
      });

      if (!completeRes.ok) throw new Error('Upload complete failed');

      setIsReplacing(false);
      router.push(`/app/documents/${createData.document.id}/upload`);
    } catch {
      setUploadState('error');
    }
  };

  if (isLoading) {
    return (
      <div className="document-page">
        <section className="page-width py-12">
          <Status variant="loading">{t.common.loading}</Status>
        </section>
      </div>
    );
  }

  if (loadError || !details) {
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
  const hasUploadedImage = Boolean(previewUrl && page);

  return (
    <div className="document-page">
      <StepHeader
        documentTitle={doc.title}
        currentStep={1}
        documentId={doc.id}
        stepLabel={t.document.uploadStep}
        backHref="/app"
        backLabel={t.document.backShort}
        status={
          hasUploadedImage ? (
            <span className="inline-flex items-center gap-1.5 px-1.5 sm:px-2 py-0.5 rounded text-[11px] font-medium bg-surface text-status-success border border-border">
              <span className="w-1.5 h-1.5 rounded-full bg-status-success shrink-0" />
              <span className="hidden sm:inline">{t.document.imageReady}</span>
              <span className="sm:hidden">OK</span>
            </span>
          ) : undefined
        }
      />

      <section className="page-width py-5 max-w-4xl mx-auto" aria-labelledby="upload-screen-title">
        {detectionError ? (
          <div className="mb-4">
            <Status variant="danger">{detectionError}</Status>
          </div>
        ) : null}

        {hasUploadedImage && !isReplacing ? (
          <div className="flex flex-col gap-6">
            {/* Image Preview Canvas */}
            <div className="relative rounded-md border border-border bg-surface p-3 sm:p-4 flex flex-col items-center justify-center">
              <div className="max-h-[600px] w-full overflow-hidden rounded border border-border/50 bg-background flex items-center justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={previewUrl!}
                  alt={doc.title}
                  className="max-h-[580px] w-auto max-w-full object-contain select-none"
                />
              </div>

              {/* Metadata & Rotation controls */}
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full text-xs text-app-text-secondary border-t border-border/50 pt-3">
                <div className="flex items-center gap-2 sm:gap-3">
                  <span>
                    {page?.width} × {page?.height} px
                  </span>
                  <span>·</span>
                  <span>{(doc.bytes / (1024 * 1024)).toFixed(2)} МБ</span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRotate(270)}
                    disabled={isRotating || isStartingDetection}
                    title={t.document.rotateLeft}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1" />
                    -90°
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRotate(90)}
                    disabled={isRotating || isStartingDetection}
                    title={t.document.rotateRight}
                  >
                    <RotateCw className="w-3.5 h-3.5 mr-1" />
                    +90°
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsReplacing(true)}
                    disabled={isRotating || isStartingDetection}
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1" />
                    {t.document.replaceImage}
                  </Button>
                </div>
              </div>
            </div>

            {/* Primary Action Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-border pt-4">
              <span className="text-xs text-app-text-secondary">
                {t.document.imageReady}
              </span>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
                <Link
                  href={`/app/documents/${doc.id}/lines`}
                  className="inline-flex items-center justify-center gap-1.5 h-11 px-4 text-sm font-medium text-app-text-secondary hover:text-app-text hover:bg-surface border border-border rounded-button transition-colors w-full sm:w-auto"
                  title={t.document.manualAnnotate}
                >
                  <PenTool className="w-4 h-4 shrink-0" />
                  <span>{t.document.manualAnnotate}</span>
                </Link>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full sm:w-auto"
                  isLoading={isStartingDetection}
                  onClick={handleStartDetection}
                >
                  {!isStartingDetection && <ScanLine className="w-4 h-4 shrink-0" />}
                  <span>{isStartingDetection ? t.document.detecting : t.document.findLinesAction}</span>
                  {!isStartingDetection && <ArrowRight className="w-4 h-4 shrink-0" />}
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <h1 id="upload-screen-title" className="text-xl font-medium text-app-text">
              {t.newDocument.uploadTitle}
            </h1>
            <p className="text-sm text-app-text-secondary">
              {t.newDocument.uploadDescription}
            </p>
            <FileUpload05
              value={files}
              onChange={handleFilesChange}
              onRemove={() => setFiles([])}
              maxFiles={1}
              maxSize={10 * 1024 * 1024}
              accept={{
                'image/jpeg': ['.jpg', '.jpeg'],
                'image/png': ['.png'],
                'image/webp': ['.webp'],
              }}
              title={t.newDocument.uploadTitle}
              description={t.newDocument.uploadDescription}
              actionLabel={t.newDocument.choose}
              hint={t.newDocument.uploadHint}
              activeLabel={t.newDocument.dropActive}
              removeLabel={t.newDocument.remove}
              progress={uploadProgress}
              uploadState={uploadState}
              errorMessage={uploadState === 'error' ? t.newDocument.uploadError : undefined}
            />
            {isReplacing ? (
              <Button variant="outline" size="sm" onClick={() => setIsReplacing(false)} className="self-start">
                Отмена
              </Button>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
