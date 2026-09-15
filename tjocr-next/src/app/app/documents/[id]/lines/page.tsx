'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Eye,
  List,
  MousePointer2,
  Plus,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Undo2,
  Trash2,
  ChevronUp,
  ChevronDown,
  ArrowRight,
} from 'lucide-react';
import { useLocale } from '@/components/app-shell';
import { StepHeader } from '@/components/ui/step-header';
import { Status } from '@/components/ui/status';
import { SiteLoader } from '@/components/ui/site-loader';
import { Button } from '@/components/ui/button';
import { RegionDto, RegionRevisionDto } from '@/domain/types';
import { LineEditor } from '@/components/document/line-editor';
import { LineSidebar } from '@/components/document/line-sidebar';
import { LineCropPreview } from '@/components/document/line-crop-preview';

interface DocumentDetails {
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
}

export default function DocumentLinesPage() {
  const { dictionary: t } = useLocale();
  const params = useParams<{ id: string }>();
  const router = useRouter();

  // State
  const [details, setDetails] = useState<DocumentDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mobileTab, setMobileTab] = useState<'canvas' | 'list'>('canvas');

  // Geometry and revision state
  const [regions, setRegions] = useState<RegionDto[]>([]);
  const [revisionNumber, setRevisionNumber] = useState<number>(0);
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<RegionDto[][]>([]);

  // Canvas viewport state
  const [mode, setMode] = useState<'select' | 'draw'>('select');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Persistence state
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Fetch document details and regions
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError(false);

      const docRes = await fetch(`/api/v1/documents/${params.id}`, { cache: 'no-store' });
      if (!docRes.ok) throw new Error('Document not found');
      const docData = (await docRes.json()) as DocumentDetails;
      setDetails(docData);

      if (docData.page?.id) {
        const regRes = await fetch(`/api/v1/pages/${docData.page.id}/regions`, { cache: 'no-store' });
        if (regRes.ok) {
          const regData = (await regRes.json()) as {
            revision: RegionRevisionDto | null;
            regions: RegionDto[];
          };
          const sorted = [...(regData.regions || [])].sort(
            (a, b) => a.readingOrder - b.readingOrder,
          );
          setRegions(sorted);
          setRevisionNumber(regData.revision?.revisionNumber || 0);
          if (sorted.length > 0) {
            setSelectedRegionId(sorted[0].id);
          }
        }
      }
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Push to Undo history before mutating
  const pushUndo = useCallback((currentRegions: RegionDto[]) => {
    setUndoStack((prev) => [...prev.slice(-20), currentRegions]);
  }, []);

  // Perform Undo
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((prev) => prev.slice(0, -1));
    setRegions(previous);
    if (selectedRegionId && !previous.some((r) => r.id === selectedRegionId)) {
      setSelectedRegionId(previous[0]?.id || null);
    }
  }, [undoStack, selectedRegionId]);

  // Mutate regions with undo tracking
  const handleRegionsChange = useCallback(
    (newRegions: RegionDto[]) => {
      pushUndo(regions);
      setRegions(newRegions);
    },
    [pushUndo, regions],
  );

  // Delete selected region
  const handleDeleteRegion = useCallback(
    (id: string) => {
      pushUndo(regions);
      const remaining = regions
        .filter((r) => r.id !== id)
        .map((r, idx) => ({ ...r, readingOrder: idx }));
      setRegions(remaining);
      setSelectedRegionId(remaining[0]?.id || null);
    },
    [pushUndo, regions],
  );

  // Change reading order
  const handleMoveReadingOrder = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const idx = regions.findIndex((r) => r.id === id);
      if (idx === -1) return;
      if (direction === 'up' && idx === 0) return;
      if (direction === 'down' && idx === regions.length - 1) return;

      pushUndo(regions);
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      const copy = [...regions];
      const temp = copy[idx];
      copy[idx] = copy[targetIdx];
      copy[targetIdx] = temp;

      const reindexed = copy.map((r, i) => ({ ...r, readingOrder: i }));
      setRegions(reindexed);
    },
    [pushUndo, regions],
  );

  // Zoom helpers
  const handleZoomIn = () => setZoom((z) => Math.min(3.5, z * 1.25));
  const handleZoomOut = () => setZoom((z) => Math.max(0.25, z * 0.8));
  const handleZoomFit = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Keyboard Shortcuts (Delete, Undo, Cycle, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        handleUndo();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRegionId) {
        e.preventDefault();
        handleDeleteRegion(selectedRegionId);
        return;
      }

      if (e.key === 'Escape') {
        setSelectedRegionId(null);
        setMode('select');
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (regions.length === 0) return;
        const currentIdx = regions.findIndex((r) => r.id === selectedRegionId);
        if (e.key === 'ArrowDown') {
          const nextIdx = currentIdx === -1 || currentIdx === regions.length - 1 ? 0 : currentIdx + 1;
          setSelectedRegionId(regions[nextIdx].id);
        } else {
          const prevIdx = currentIdx <= 0 ? regions.length - 1 : currentIdx - 1;
          setSelectedRegionId(regions[prevIdx].id);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleDeleteRegion, selectedRegionId, regions]);

  // Save Revision and proceed to stage 5 (recognition)
  const handleSaveAndRecognize = async () => {
    if (!details?.page?.id || isSaving) return;
    setIsSaving(true);
    setSaveError(null);

    try {
      const payload = {
        expectedRevision: revisionNumber,
        regions: regions.map((r, idx) => ({
          readingOrder: idx,
          geometry: r.geometry,
          excluded: r.excluded || false,
        })),
      };

      const res = await fetch(`/api/v1/pages/${details.page.id}/regions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        if (res.status === 409) {
          throw new Error(t.document.revisionConflict);
        }
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error?.messageKey || 'Не удалось сохранить разметку строк');
      }

      setSaveSuccess(true);
      // Proceed to Stage 5: Recognition
      router.push(`/app/documents/${details.document.id}/recognize`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Ошибка при сохранении строк');
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <SiteLoader />;
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
  const imageWidth = page?.width || 1200;
  const imageHeight = page?.height || 1600;
  const selectedRegion = regions.find((r) => r.id === selectedRegionId);

  return (
    <div className="flex flex-col h-[calc(100vh-var(--site-header-height))] overflow-hidden">
      <StepHeader
        documentTitle={doc.title}
        currentStep={3}
        documentId={doc.id}
        stepLabel={t.document.linesStep}
        backHref={`/app/documents/${doc.id}/detect`}
        backLabel={t.document.backToDetect}
        fullWidth
      />

      {/* Notifications Banner if conflict or error */}
      {saveError && (
        <div className="bg-status-danger/10 border-b border-status-danger/30 text-status-danger px-4 py-2 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{saveError}</span>
          </div>
          <button
            type="button"
            className="underline hover:no-underline font-medium text-xs ml-2 cursor-pointer"
            onClick={loadData}
          >
            Обновить данные
          </button>
        </div>
      )}

      {saveSuccess && (
        <div className="bg-status-success/10 border-b border-status-success/30 text-status-success px-4 py-2 text-xs flex items-center gap-1.5 shrink-0">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{t.document.savedRevision}</span>
        </div>
      )}

      {/* 1. Mobile Segmented Tab Switcher (< lg) */}
      <div className="flex items-center justify-center p-1.5 bg-surface border-b border-border lg:hidden gap-1.5 shrink-0 select-none">
        <button
          type="button"
          onClick={() => setMobileTab('canvas')}
          className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors ${
            mobileTab === 'canvas'
              ? 'bg-background text-app-text shadow-xs border border-border'
              : 'text-app-text-secondary hover:text-app-text'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{t.document.canvasTab}</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab('list')}
          className={`flex-1 py-1.5 px-3 text-xs font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors ${
            mobileTab === 'list'
              ? 'bg-background text-app-text shadow-xs border border-border'
              : 'text-app-text-secondary hover:text-app-text'
          }`}
        >
          <List className="w-3.5 h-3.5" />
          <span>{t.document.listTab}</span>
          <span className="ml-1 px-1.5 py-0.2 bg-primary-bg text-primary-text rounded-full text-[10px] font-mono">
            {regions.length}
          </span>
        </button>
      </div>

      {/* 2. Mobile Views (< lg) */}
      <div className="flex-1 min-h-0 flex flex-col lg:hidden overflow-hidden">
        {mobileTab === 'canvas' ? (
          <div className="flex-1 min-h-0 relative overflow-hidden bg-[#0d0d0d] flex flex-col">
            {/* Mobile Floating Quick Toolbar */}
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 p-1 bg-white/95 dark:bg-[#18181b]/95 backdrop-blur-md border border-black/10 dark:border-white/15 rounded-full shadow-lg max-w-[95%]">
              <button
                type="button"
                onClick={() => setMode('select')}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  mode === 'select'
                    ? 'bg-black/15 text-black border border-black/20 dark:bg-white/20 dark:text-white dark:border-white/25 shadow-xs font-semibold'
                    : 'text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10'
                }`}
                title="Выделение"
                aria-label="Выделение"
              >
                <MousePointer2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMode('draw')}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  mode === 'draw'
                    ? 'bg-black/15 text-black border border-black/20 dark:bg-white/20 dark:text-white dark:border-white/25 shadow-xs font-semibold'
                    : 'text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10'
                }`}
                title={t.document.addLine}
                aria-label={t.document.addLine}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <span className="w-px h-3.5 bg-black/20 dark:bg-white/20 mx-0.5" aria-hidden="true" />
              <button
                type="button"
                onClick={handleZoomOut}
                className="w-7 h-7 rounded-full flex items-center justify-center text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                title={t.document.zoomOut}
                aria-label={t.document.zoomOut}
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <span className="text-[10px] font-mono font-medium px-1 select-none text-black dark:text-white min-w-[34px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={handleZoomIn}
                className="w-7 h-7 rounded-full flex items-center justify-center text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                title={t.document.zoomIn}
                aria-label={t.document.zoomIn}
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={handleZoomFit}
                className="w-7 h-7 rounded-full flex items-center justify-center text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                title={t.document.fitToScreen}
                aria-label={t.document.fitToScreen}
              >
                <Maximize2 className="w-3 h-3" />
              </button>
              <span className="w-px h-3.5 bg-black/20 dark:bg-white/20 mx-0.5" aria-hidden="true" />
              <button
                type="button"
                onClick={handleUndo}
                disabled={undoStack.length === 0}
                className="w-7 h-7 rounded-full flex items-center justify-center text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                title={`${t.document.undo} (Ctrl+Z)`}
                aria-label={t.document.undo}
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Mobile Canvas Area */}
            <div className="flex-1 min-h-0 relative overflow-hidden flex items-center justify-center">
              {previewUrl ? (
                <LineEditor
                  imageUrl={previewUrl}
                  imageWidth={imageWidth}
                  imageHeight={imageHeight}
                  regions={regions}
                  selectedRegionId={selectedRegionId}
                  onSelectRegion={setSelectedRegionId}
                  onChangeRegions={handleRegionsChange}
                  mode={mode}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  pan={pan}
                  onPanChange={setPan}
                />
              ) : (
                <div className="text-app-text-secondary text-sm">Изображение недоступно</div>
              )}
            </div>

            {/* Floating selected line inspector badge */}
            {selectedRegion && (
              <div className="absolute bottom-16 left-2 right-2 z-20 bg-white/95 dark:bg-[#18181b]/95 backdrop-blur-md border border-black/10 dark:border-white/15 rounded-xl p-2.5 shadow-lg flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-16 h-8 rounded border border-border/70 overflow-hidden bg-black/50 shrink-0 flex items-center justify-center">
                    <LineCropPreview
                      imageUrl={previewUrl || ''}
                      imageWidth={imageWidth}
                      imageHeight={imageHeight}
                      geometry={selectedRegion.geometry}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold flex items-center gap-1 truncate">
                      <span className="px-1 py-0.2 bg-primary-bg text-primary-text rounded text-[10px] font-mono">
                        #{selectedRegion.readingOrder + 1}
                      </span>
                      <span className="text-[10px] font-mono text-app-text-secondary">
                        {selectedRegion.geometry.width}×{selectedRegion.geometry.height}px
                      </span>
                    </div>
                    <div className="text-[10px] text-app-text-secondary truncate">
                      {selectedRegion.readingOrder + 1} из {regions.length}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleMoveReadingOrder(selectedRegion.id, 'up')}
                    disabled={selectedRegion.readingOrder === 0}
                    className="w-7 h-7 rounded flex items-center justify-center bg-surface border border-border text-app-text disabled:opacity-30 transition-colors"
                    title={t.document.moveUp}
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveReadingOrder(selectedRegion.id, 'down')}
                    disabled={selectedRegion.readingOrder === regions.length - 1}
                    className="w-7 h-7 rounded flex items-center justify-center bg-surface border border-border text-app-text disabled:opacity-30 transition-colors"
                    title={t.document.moveDown}
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteRegion(selectedRegion.id)}
                    className="w-7 h-7 rounded flex items-center justify-center bg-status-danger/10 border border-status-danger/30 text-status-danger hover:bg-status-danger/20 transition-colors"
                    title={t.document.deleteLine}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Mobile Canvas Bottom Action */}
            <div className="p-2.5 border-t border-border bg-background shrink-0">
              <Button
                variant="primary"
                size="md"
                className="w-full justify-center h-10 text-xs font-medium"
                disabled={regions.length === 0}
                isLoading={isSaving}
                onClick={handleSaveAndRecognize}
              >
                <span>{t.document.recognizeLinesAction} ({regions.length})</span>
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </div>
        ) : (
          /* Mobile List View: Full-Height List with Sharp Crops */
          <div className="flex-1 min-h-0 flex flex-col bg-surface/30 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 min-h-0">
              {regions.length === 0 ? (
                <div className="p-8 text-center text-xs text-app-text-secondary">
                  {t.document.noLinesYet}
                </div>
              ) : (
                regions.map((region, idx) => (
                  <div
                    key={region.id}
                    onClick={() => setSelectedRegionId(region.id)}
                    className={`p-3 rounded-xl border transition-all ${
                      region.id === selectedRegionId
                        ? 'border-focus bg-focus/5 shadow-xs'
                        : 'border-border bg-background'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary-bg text-primary-text flex items-center justify-center text-[10px] font-bold font-mono">
                          {idx + 1}
                        </span>
                        <span className="text-xs font-medium text-app-text">
                          {t.document.lineBadge} {idx + 1}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-app-text-secondary">
                        {region.geometry.width} × {region.geometry.height} px
                      </span>
                    </div>

                    {/* Crop Preview in List */}
                    <div className="w-full h-14 rounded-lg border border-border/70 overflow-hidden bg-black/40 flex items-center justify-center mb-2">
                      <LineCropPreview
                        imageUrl={previewUrl || ''}
                        imageWidth={imageWidth}
                        imageHeight={imageHeight}
                        geometry={region.geometry}
                      />
                    </div>

                    {/* Item Controls */}
                    <div className="flex items-center justify-between pt-1 border-t border-border/40">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedRegionId(region.id);
                          setMobileTab('canvas');
                        }}
                        className="text-xs text-focus hover:underline inline-flex items-center gap-1 font-medium"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{t.document.showOnCanvas}</span>
                      </button>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveReadingOrder(region.id, 'up');
                          }}
                          disabled={idx === 0}
                          title={t.document.moveUp}
                        >
                          <ChevronUp className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMoveReadingOrder(region.id, 'down');
                          }}
                          disabled={idx === regions.length - 1}
                          title={t.document.moveDown}
                        >
                          <ChevronDown className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-status-danger border-status-danger/30 hover:bg-status-danger/10 ml-1"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRegion(region.id);
                          }}
                          title={t.document.deleteLine}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Mobile List Bottom Action */}
            <div className="p-2.5 border-t border-border bg-background shrink-0">
              <Button
                variant="primary"
                size="md"
                className="w-full justify-center h-10 text-xs font-medium"
                disabled={regions.length === 0}
                isLoading={isSaving}
                onClick={handleSaveAndRecognize}
              >
                <span>{t.document.recognizeLinesAction} ({regions.length})</span>
                <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 3. Desktop 2-Column Layout (>= lg) */}
      <div className="hidden lg:flex flex-1 min-h-0 relative overflow-hidden flex-row">
        {/* Left Column: Canvas Viewport */}
        <div className="flex-1 min-w-0 h-full relative overflow-hidden bg-[#0d0d0d] flex items-center justify-center">
          {previewUrl ? (
            <LineEditor
              imageUrl={previewUrl}
              imageWidth={imageWidth}
              imageHeight={imageHeight}
              regions={regions}
              selectedRegionId={selectedRegionId}
              onSelectRegion={setSelectedRegionId}
              onChangeRegions={handleRegionsChange}
              mode={mode}
              zoom={zoom}
              onZoomChange={setZoom}
              pan={pan}
              onPanChange={setPan}
            />
          ) : (
            <div className="text-app-text-secondary text-sm">Изображение недоступно</div>
          )}
        </div>

        {/* Right Column: Tools & Line Inspector Sidebar */}
        <div className="w-80 xl:w-96 shrink-0 h-full overflow-hidden border-l border-border bg-background">
          <LineSidebar
            regions={regions}
            selectedRegionId={selectedRegionId}
            onSelectRegion={setSelectedRegionId}
            onDeleteRegion={handleDeleteRegion}
            onMoveReadingOrder={handleMoveReadingOrder}
            onUndo={handleUndo}
            canUndo={undoStack.length > 0}
            mode={mode}
            onModeChange={setMode}
            zoom={zoom}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onZoomFit={handleZoomFit}
            imageUrl={previewUrl || ''}
            imageWidth={imageWidth}
            imageHeight={imageHeight}
            onSaveAndRecognize={handleSaveAndRecognize}
            isSaving={isSaving}
          />
        </div>
      </div>
    </div>
  );
}
