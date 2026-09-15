'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CheckCircle2, Download, FileText, Loader2, RefreshCw, X, XCircle } from 'lucide-react';
import { useLocale } from '@/components/app-shell';
import { LineOverlay } from '@/components/document/line-overlay';
import { Button } from '@/components/ui/button';
import { SiteLoader } from '@/components/ui/site-loader';
import { StepHeader } from '@/components/ui/step-header';
import type { LineResultDto, RegionDto } from '@/domain/types';
import { ExportLayoutItem, formatExportText } from '@/lib/export-layout';

type SaveState =
  | { kind: 'idle' | 'saving' | 'saved' | 'error' }
  | { kind: 'conflict'; currentText: string; currentVersion: number };
type ExportFormat = 'txt' | 'docx';
type ExportModal = { format: ExportFormat; state: 'analysing' | 'ready' | 'error' | 'downloading'; layout?: ExportLayoutItem[] };
type DocumentPayload = {
  document: { id: string; title: string };
  page: { id: string; width: number; height: number } | null;
  previewUrl: string | null;
};

function ExportDialog({ modal, previewText, copy, onClose, onRetry, onDownload }: {
  modal: ExportModal | null;
  previewText: string;
  copy: Record<string, string>;
  onClose: () => void;
  onRetry: () => void;
  onDownload: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (modal && !dialog.open) dialog.showModal();
    if (!modal && dialog.open) dialog.close();
  }, [modal]);
  if (!modal) return <dialog ref={dialogRef} className="export-dialog" />;
  const isWorking = modal.state === 'analysing' || modal.state === 'downloading';
  return (
    <dialog ref={dialogRef} className="export-dialog" aria-labelledby="export-dialog-title" onCancel={(event) => { event.preventDefault(); if (!isWorking) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !isWorking) onClose(); }}>
      <section className="export-dialog__surface" aria-busy={isWorking}>
        <header className="export-dialog__header"><div><p className="eyebrow">{modal.format.toUpperCase()}</p><h2 id="export-dialog-title">{copy.exportPreviewTitle}</h2></div><button className="export-dialog__close" type="button" onClick={onClose} disabled={isWorking} aria-label={copy.exportClose}><X className="h-4 w-4" /></button></header>
        <p className="export-dialog__description">{copy.exportPreviewDescription}</p>
        {modal.state === 'analysing' && <div className="export-layout-loading" role="status"><div><strong>{copy.exportPreparing}</strong><p>{copy.exportPreparingHint}</p></div><div className="export-layout-skeleton" aria-hidden="true"><span /><span /><span /><span /></div></div>}
        {modal.state === 'error' && <div className="export-layout-error" role="alert"><XCircle className="h-4 w-4" /><span>{copy.exportLayoutFailed}</span></div>}
        {(modal.state === 'ready' || modal.state === 'downloading') && <div className="export-preview"><div className="export-preview__meta"><CheckCircle2 className="h-4 w-4" /><span><strong>{copy.exportReady}</strong> · {copy.exportReadyHint}</span></div><pre>{previewText || ' '}</pre></div>}
        <footer className="export-dialog__actions">
          {modal.state === 'error' && <Button type="button" variant="outline" onClick={onRetry}>{copy.exportRetry}</Button>}
          <Button type="button" variant="secondary" onClick={onClose} disabled={isWorking}>{copy.exportClose}</Button>
          {(modal.state === 'ready' || modal.state === 'downloading') && <Button type="button" onClick={onDownload} disabled={modal.state === 'downloading'}>{modal.state === 'downloading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{copy.exportDownload}</Button>}
        </footer>
      </section>
    </dialog>
  );
}

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
  const [modal, setModal] = useState<ExportModal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const exportAbort = useRef<AbortController | null>(null);

  const loadPage = useCallback(async () => {
    try {
      setLoading(true); setError(null);
      const [documentResponse, resultsResponse] = await Promise.all([fetch(`/api/v1/documents/${documentId}`, { cache: 'no-store' }), fetch(`/api/v1/documents/${documentId}/line-results`, { cache: 'no-store' })]);
      if (!documentResponse.ok || !resultsResponse.ok) throw new Error(t.document.notFound);
      const [documentPayload, resultsPayload] = await Promise.all([documentResponse.json() as Promise<DocumentPayload>, resultsResponse.json() as Promise<{ lineResults?: LineResultDto[] }>]);
      const nextResults = resultsPayload.lineResults || [];
      setDocumentData(documentPayload); setResults(nextResults);
      setDrafts(Object.fromEntries(nextResults.map((result) => [result.id, result.editedText ?? result.rawText])));
      setVersions(Object.fromEntries(nextResults.map((result) => [result.id, result.editVersion ?? 0])));
      setSelectedId((previous) => previous && nextResults.some((result) => result.id === previous) ? previous : nextResults[0]?.id ?? null);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : t.document.notFound); } finally { setLoading(false); }
  }, [documentId, t.document.notFound]);

  useEffect(() => { void loadPage(); return () => { Object.values(saveTimers.current).forEach(clearTimeout); exportAbort.current?.abort(); }; }, [loadPage]);

  const saveLine = useCallback(async (line: LineResultDto, text: string, expectedVersion = versions[line.id] ?? 0) => {
    setSaveStates((previous) => ({ ...previous, [line.id]: { kind: 'saving' } }));
    try {
      const response = await fetch(`/api/v1/line-results/${line.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ editedText: text, expectedVersion }) });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409 && payload.current) { setSaveStates((previous) => ({ ...previous, [line.id]: { kind: 'conflict', currentText: payload.current.editedText, currentVersion: payload.current.version } })); return; }
      if (!response.ok || !payload.edit) throw new Error('TEXT_EDIT_SAVE_FAILED');
      setVersions((previous) => ({ ...previous, [line.id]: payload.edit.version })); setSaveStates((previous) => ({ ...previous, [line.id]: { kind: 'saved' } }));
    } catch { setSaveStates((previous) => ({ ...previous, [line.id]: { kind: 'error' } })); }
  }, [versions]);

  const scheduleSave = useCallback((line: LineResultDto, value: string) => {
    setDrafts((previous) => ({ ...previous, [line.id]: value })); setSaveStates((previous) => ({ ...previous, [line.id]: { kind: 'saving' } }));
    clearTimeout(saveTimers.current[line.id]); saveTimers.current[line.id] = setTimeout(() => { void saveLine(line, value); }, 650);
  }, [saveLine]);
  const useServerVersion = (lineId: string, currentText: string, currentVersion: number) => { setDrafts((previous) => ({ ...previous, [lineId]: currentText })); setVersions((previous) => ({ ...previous, [lineId]: currentVersion })); setSaveStates((previous) => ({ ...previous, [lineId]: { kind: 'saved' } })); };

  const startExport = useCallback(async (format: ExportFormat) => {
    exportAbort.current?.abort(); const controller = new AbortController(); exportAbort.current = controller; setModal({ format, state: 'analysing' });
    try {
      const response = await fetch(`/api/v1/documents/${documentId}/export-layout`, { method: 'POST', signal: controller.signal }); const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(payload.layout)) throw new Error('EXPORT_LAYOUT_FAILED');
      if (!controller.signal.aborted) setModal({ format, state: 'ready', layout: payload.layout });
    } catch { if (!controller.signal.aborted) setModal({ format, state: 'error' }); } finally { if (exportAbort.current === controller) exportAbort.current = null; }
  }, [documentId]);
  const closeExport = () => { exportAbort.current?.abort(); exportAbort.current = null; setModal(null); };
  const downloadExport = async () => {
    if (!modal?.layout || !documentData) return;
    setModal({ ...modal, state: 'downloading' });
    try {
      const response = await fetch(`/api/v1/documents/${documentData.document.id}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format: modal.format, layout: modal.layout }) });
      if (!response.ok) throw new Error('EXPORT_FILE_FAILED');
      const blob = await response.blob(); const link = window.document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${documentData.document.title || 'tjocr-result'}.${modal.format}`; window.document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(link.href);
      setModal({ ...modal, state: 'ready' });
    } catch { setModal({ ...modal, state: 'error' }); }
  };

  const selectedLine = results.find((result) => result.id === selectedId) ?? null;
  const successfulCount = results.filter((result) => result.status === 'succeeded').length;
  const failedCount = results.length - successfulCount;
  const hasPendingSave = Object.values(saveStates).some((state) => state.kind === 'saving' || state.kind === 'error' || state.kind === 'conflict');
  const regions = useMemo<RegionDto[]>(() => results.flatMap((result, index) => result.geometry ? [{ id: result.regionId, revisionId: '', readingOrder: result.readingOrder ?? index, geometry: result.geometry, excluded: false, createdAt: result.createdAt }] : []), [results]);
  const previewText = useMemo(() => modal?.layout ? formatExportText(results.map((result, index) => ({ index, text: result.status === 'succeeded' ? (drafts[result.id] ?? '') : '' })), modal.layout) : '', [drafts, modal?.layout, results]);

  if (loading) return <SiteLoader />;
  if (error || !documentData) return <main className="page-width py-12"><p className="text-sm text-status-danger">{error || t.document.notFound}</p><Link className="text-action text-action--back" href="/app">{t.document.back}</Link></main>;
  const { document, page, previewUrl } = documentData;
  return (
    <div className="document-page">
      <StepHeader documentTitle={document.title} documentId={document.id} currentStep={5} stepLabel={t.document.resultStep} backHref={`/app/documents/${document.id}/recognize`} backLabel={t.document.backToRecognition} />
      <main className="page-width result-screen">
        <header className="result-page-header"><div><p className="eyebrow">{t.document.resultStep}</p><h1>{t.document.resultTitle}</h1><p>{t.document.resultSubtitle}</p></div><div className="result-export-actions"><Button variant="outline" onClick={() => void startExport('txt')} disabled={hasPendingSave || results.length === 0}><Download className="h-4 w-4" />{t.document.exportTxt}</Button><Button onClick={() => void startExport('docx')} disabled={hasPendingSave || results.length === 0}><FileText className="h-4 w-4" />{t.document.exportDocx}</Button></div></header>
        {hasPendingSave && <p className="result-export-note" role="status">{t.document.exportSavePending}</p>}
        {failedCount > 0 && <p className="result-export-note">{t.document.exportPartialNotice}</p>}
        <div className="result-workspace">
          <aside className="result-preview-pane" aria-label={t.document.resultCropTitle}><div className="result-preview-pane__header"><span>{t.document.resultCropTitle}</span>{selectedLine && <span className="font-mono">{(selectedLine.readingOrder ?? 0) + 1}</span>}</div>{page && previewUrl && regions.length > 0 ? <LineOverlay imageUrl={previewUrl} imageWidth={page.width} imageHeight={page.height} regions={regions} selectedRegionId={selectedLine?.regionId} onSelectRegion={(regionId) => setSelectedId(results.find((line) => line.regionId === regionId)?.id ?? null)} className="result-page-preview" /> : <div className="result-preview-empty">{t.document.resultMissing}</div>}</aside>
          <section className="result-editor-pane" aria-label={t.document.resultTextLabel}><div className="result-editor-pane__header"><div><h2>{t.document.resultTextLabel}</h2><span>{results.length}</span></div><p>{successfulCount} {t.document.lineStatusSuccess}{failedCount ? ` · ${failedCount} ${t.document.lineStatusFailed}` : ''}</p></div><div className="result-editor-list">
            {results.map((line, index) => { const isSuccessful = line.status === 'succeeded'; const state = saveStates[line.id] || { kind: 'idle' as const }; return <article key={line.id} className={`result-text-row ${selectedId === line.id ? 'result-text-row--selected' : ''}`} onClick={() => setSelectedId(line.id)}><span className="result-text-row__number">{index + 1}</span><div className="min-w-0 flex-1">{isSuccessful ? <><textarea value={drafts[line.id] ?? ''} onFocus={() => setSelectedId(line.id)} onChange={(event) => scheduleSave(line, event.target.value)} aria-label={`${t.document.lineBadge} ${index + 1}`} /><div className="result-text-row__status" aria-live="polite">{state.kind === 'saving' && <span><Loader2 className="h-3 w-3 animate-spin" />{t.document.resultSaving}</span>}{state.kind === 'saved' && <span className="text-status-success"><CheckCircle2 className="h-3 w-3" />{t.document.resultSaved}</span>}{state.kind === 'error' && <span className="text-status-danger"><XCircle className="h-3 w-3" />{t.document.resultSaveFailed}</span>}{state.kind === 'idle' && <span>{t.document.resultEditHint}</span>}{state.kind === 'conflict' && <><span className="text-status-danger">{t.document.resultConflict}</span><button onClick={(event) => { event.stopPropagation(); useServerVersion(line.id, state.currentText, state.currentVersion); }}>{t.document.resultUseServer}</button><button onClick={(event) => { event.stopPropagation(); void saveLine(line, drafts[line.id] ?? '', state.currentVersion); }}><RefreshCw className="h-3 w-3" />{t.document.resultSaveMine}</button></>}</div></> : <p className="result-text-row__missing">{t.document.resultMissing}</p>}</div></article>; })}
          </div></section>
        </div>
      </main>
      <ExportDialog modal={modal} previewText={previewText} copy={t.document} onClose={closeExport} onRetry={() => { if (modal) void startExport(modal.format); }} onDownload={() => void downloadExport()} />
    </div>
  );
}
