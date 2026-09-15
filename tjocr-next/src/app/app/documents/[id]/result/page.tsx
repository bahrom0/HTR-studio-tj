'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CheckCircle2, Download, FileText, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useLocale } from '@/components/app-shell';
import { LineCropPreview } from '@/components/document/line-crop-preview';
import { Button } from '@/components/ui/button';
import { SiteLoader } from '@/components/ui/site-loader';
import { StepHeader } from '@/components/ui/step-header';
import type { LineResultDto } from '@/domain/types';

type SaveState =
  | { kind: 'idle' | 'saving' | 'saved' | 'error' }
  | { kind: 'conflict'; currentText: string; currentVersion: number };

type DocumentPayload = {
  document: { id: string; title: string };
  page: { id: string; width: number; height: number } | null;
  previewUrl: string | null;
};

export default function ResultPage() {
  const { dictionary: t } = useLocale();
  const params = useParams<{ id: string }>();
  const documentId = params.id;
  const [documentData, setDocumentData] = useState<DocumentPayload | null>(null);
  const [results, setResults] = useState<LineResultDto[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [saveStates, setSaveStates] = useState<Record<string, SaveState>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const loadPage = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [documentResponse, resultsResponse] = await Promise.all([
        fetch(`/api/v1/documents/${documentId}`, { cache: 'no-store' }),
        fetch(`/api/v1/documents/${documentId}/line-results`, { cache: 'no-store' }),
      ]);
      if (!documentResponse.ok || !resultsResponse.ok) throw new Error(t.document.notFound);

      const [documentPayload, resultsPayload] = await Promise.all([
        documentResponse.json() as Promise<DocumentPayload>,
        resultsResponse.json() as Promise<{ lineResults?: LineResultDto[] }>,
      ]);
      const nextResults = resultsPayload.lineResults || [];
      setDocumentData(documentPayload);
      setResults(nextResults);
      setDrafts(Object.fromEntries(nextResults.map((result) => [result.id, result.editedText ?? result.rawText])));
      setVersions(Object.fromEntries(nextResults.map((result) => [result.id, result.editVersion ?? 0])));
      setSelectedId((previous) => previous && nextResults.some((result) => result.id === previous)
        ? previous
        : nextResults[0]?.id ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t.document.notFound);
    } finally {
      setLoading(false);
    }
  }, [documentId, t.document.notFound]);

  useEffect(() => {
    void loadPage();
    return () => Object.values(saveTimers.current).forEach((timer) => clearTimeout(timer));
  }, [loadPage]);

  const saveLine = useCallback(async (line: LineResultDto, text: string, expectedVersion = versions[line.id] ?? 0) => {
    setSaveStates((previous) => ({ ...previous, [line.id]: { kind: 'saving' } }));
    try {
      const response = await fetch(`/api/v1/line-results/${line.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ editedText: text, expectedVersion }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload.current) {
        setSaveStates((previous) => ({
          ...previous,
          [line.id]: {
            kind: 'conflict',
            currentText: payload.current.editedText,
            currentVersion: payload.current.version,
          },
        }));
        return;
      }
      if (!response.ok || !payload.edit) throw new Error('TEXT_EDIT_SAVE_FAILED');
      setVersions((previous) => ({ ...previous, [line.id]: payload.edit.version }));
      setSaveStates((previous) => ({ ...previous, [line.id]: { kind: 'saved' } }));
    } catch {
      setSaveStates((previous) => ({ ...previous, [line.id]: { kind: 'error' } }));
    }
  }, [versions]);

  const scheduleSave = useCallback((line: LineResultDto, value: string) => {
    setDrafts((previous) => ({ ...previous, [line.id]: value }));
    setSaveStates((previous) => ({ ...previous, [line.id]: { kind: 'saving' } }));
    clearTimeout(saveTimers.current[line.id]);
    saveTimers.current[line.id] = setTimeout(() => {
      void saveLine(line, value);
    }, 650);
  }, [saveLine]);

  const useServerVersion = (lineId: string, currentText: string, currentVersion: number) => {
    setDrafts((previous) => ({ ...previous, [lineId]: currentText }));
    setVersions((previous) => ({ ...previous, [lineId]: currentVersion }));
    setSaveStates((previous) => ({ ...previous, [lineId]: { kind: 'saved' } }));
  };

  const selectedLine = results.find((result) => result.id === selectedId) ?? null;
  const successfulCount = results.filter((result) => result.status === 'succeeded').length;
  const failedCount = results.length - successfulCount;

  if (loading) return <SiteLoader />;

  if (error || !documentData) {
    return (
      <main className="page-width py-12">
        <p className="text-sm text-status-danger">{error || t.document.notFound}</p>
        <Link className="text-action text-action--back" href="/app">{t.document.back}</Link>
      </main>
    );
  }

  const { document: document, page, previewUrl } = documentData;
  const download = (format: 'txt' | 'docx') => {
    window.location.assign(`/api/v1/documents/${document.id}/export?format=${format}`);
  };

  return (
    <div className="document-page">
      <StepHeader
        documentTitle={document.title}
        documentId={document.id}
        currentStep={5}
        stepLabel={t.document.resultStep}
        backHref={`/app/documents/${document.id}/recognize`}
        backLabel={t.document.backToRecognition}
      />

      <main className="page-width w-full max-w-5xl py-6 md:py-8">
        <section className="flex flex-col gap-5 md:gap-6">
          <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="eyebrow">{t.document.resultStep}</p>
              <h1 className="m-0 text-2xl font-semibold tracking-tight md:text-3xl">{t.document.resultTitle}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-app-text-secondary">{t.document.resultSubtitle}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="w-full sm:w-auto" variant="outline" onClick={() => download('txt')}>
                <Download className="h-4 w-4" aria-hidden="true" />
                {t.document.exportTxt}
              </Button>
              <Button className="w-full sm:w-auto" onClick={() => download('docx')}>
                <FileText className="h-4 w-4" aria-hidden="true" />
                {t.document.exportDocx}
              </Button>
            </div>
          </header>

          {failedCount > 0 && (
            <p className="m-0 rounded-panel border border-border bg-surface px-3 py-2 text-sm text-app-text-secondary">
              {t.document.exportPartialNotice}
            </p>
          )}

          {selectedLine && page && previewUrl && selectedLine.geometry && (
            <section className="rounded-panel border border-border bg-surface p-4 md:p-5" aria-label={t.document.resultCropTitle}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="m-0 text-sm font-semibold">{t.document.resultCropTitle}</h2>
                <span className="font-mono text-xs text-app-text-secondary">{selectedLine.readingOrder ?? 0}</span>
              </div>
              <div className="max-h-44 overflow-hidden rounded-input border border-border bg-background">
                <LineCropPreview
                  imageUrl={previewUrl}
                  imageWidth={page.width}
                  imageHeight={page.height}
                  geometry={selectedLine.geometry}
                />
              </div>
            </section>
          )}

          <section className="rounded-dialog border border-border bg-surface p-3 sm:p-4 md:p-5">
            <div className="mb-3 flex flex-col gap-2 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <h2 className="m-0 text-sm font-semibold">{t.document.resultTextLabel}</h2>
                <span className="rounded-full bg-surface-hover px-1.5 py-0.5 font-mono text-xs text-app-text-secondary">{results.length}</span>
              </div>
              <span className="text-xs text-app-text-secondary">
                {successfulCount} {t.document.lineStatusSuccess}{failedCount ? ` · ${failedCount} ${t.document.lineStatusFailed}` : ''}
              </span>
            </div>

            <div className="grid gap-2.5">
              {results.map((line, index) => {
                const isSuccessful = line.status === 'succeeded';
                const state = saveStates[line.id] || { kind: 'idle' as const };
                return (
                  <article
                    key={line.id}
                    className={`rounded-panel border bg-background p-3 transition-colors ${selectedId === line.id ? 'border-app-text' : 'border-border'}`}
                    onClick={() => setSelectedId(line.id)}
                  >
                    <div className="flex gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface font-mono text-xs text-app-text-secondary">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        {isSuccessful ? (
                          <>
                            <textarea
                              className="min-h-11 w-full resize-y rounded-input border border-transparent bg-transparent px-2 py-1.5 text-sm leading-6 text-app-text outline-none transition-colors focus:border-focus focus:bg-surface"
                              value={drafts[line.id] ?? ''}
                              onFocus={() => setSelectedId(line.id)}
                              onChange={(event) => scheduleSave(line, event.target.value)}
                              aria-label={`${t.document.lineBadge} ${index + 1}`}
                            />
                            <div className="mt-1 flex min-h-5 flex-wrap items-center gap-2 px-2 text-xs" aria-live="polite">
                              {state.kind === 'saving' && <span className="inline-flex items-center gap-1 text-app-text-secondary"><Loader2 className="h-3 w-3 animate-spin" />{t.document.resultSaving}</span>}
                              {state.kind === 'saved' && <span className="inline-flex items-center gap-1 text-status-success"><CheckCircle2 className="h-3 w-3" />{t.document.resultSaved}</span>}
                              {state.kind === 'error' && <span className="inline-flex items-center gap-1 text-status-danger"><XCircle className="h-3 w-3" />{t.document.resultSaveFailed}</span>}
                              {state.kind === 'conflict' && (
                                <>
                                  <span className="text-status-danger">{t.document.resultConflict}</span>
                                  <button className="text-action text-action--underlined min-h-0 text-xs" onClick={(event) => { event.stopPropagation(); useServerVersion(line.id, state.currentText, state.currentVersion); }}>{t.document.resultUseServer}</button>
                                  <button className="text-action text-action--underlined min-h-0 text-xs" onClick={(event) => { event.stopPropagation(); void saveLine(line, drafts[line.id] ?? '', state.currentVersion); }}><RefreshCw className="h-3 w-3" />{t.document.resultSaveMine}</button>
                                </>
                              )}
                              {state.kind === 'idle' && <span className="text-app-text-secondary">{t.document.resultEditHint}</span>}
                            </div>
                          </>
                        ) : (
                          <p className="m-0 px-2 py-2 text-sm text-app-text-secondary">{t.document.resultMissing}</p>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}
