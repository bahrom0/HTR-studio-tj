'use client';

import React from 'react';
import {
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
  Layers,
} from 'lucide-react';
import { RegionDto } from '@/domain/types';
import { Button } from '@/components/ui/button';
import { LineCropPreview } from '@/components/document/line-crop-preview';
import { useLocale } from '@/components/app-shell';

export interface LineSidebarProps {
  regions: readonly RegionDto[];
  selectedRegionId: string | null;
  onSelectRegion: (id: string | null) => void;
  onDeleteRegion: (id: string) => void;
  onMoveReadingOrder: (id: string, direction: 'up' | 'down') => void;
  onUndo: () => void;
  canUndo: boolean;
  mode: 'select' | 'draw';
  onModeChange: (mode: 'select' | 'draw') => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomFit: () => void;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onSaveAndRecognize: () => void;
  isSaving: boolean;
  className?: string;
}

export function LineSidebar({
  regions,
  selectedRegionId,
  onSelectRegion,
  onDeleteRegion,
  onMoveReadingOrder,
  onUndo,
  canUndo,
  mode,
  onModeChange,
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomFit,
  imageUrl,
  imageWidth,
  imageHeight,
  onSaveAndRecognize,
  isSaving,
  className = '',
}: Readonly<LineSidebarProps>) {
  const { dictionary: t } = useLocale();

  // Find currently selected region
  const selectedRegion = regions.find((r) => r.id === selectedRegionId);
  const selectedIndex = regions.findIndex((r) => r.id === selectedRegionId);
  const canMoveUp = selectedIndex > 0;
  const canMoveDown = selectedIndex !== -1 && selectedIndex < regions.length - 1;

  return (
    <aside
      className={`flex flex-col bg-background overflow-hidden h-full max-h-full ${className}`}
      aria-label="Панель инструментов редактора строк"
    >
      {/* 1. Quick Toolbar: Modes & Zoom & Undo */}
      <div className="flex items-center justify-between p-2.5 border-b border-border bg-surface shrink-0 gap-1">
        {/* Modes: Select / Draw */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onModeChange('select')}
            className={`inline-flex items-center justify-center w-8 h-8 rounded text-xs transition-colors ${
              mode === 'select'
                ? 'bg-primary-bg text-primary-text font-medium shadow-xs'
                : 'text-app-text-secondary hover:bg-surface-hover hover:text-app-text'
            }`}
            title="Выделение и перемещение строк"
            aria-label="Режим выделения"
            aria-pressed={mode === 'select'}
          >
            <MousePointer2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onModeChange('draw')}
            className={`inline-flex items-center justify-center w-8 h-8 rounded text-xs transition-colors ${
              mode === 'draw'
                ? 'bg-primary-bg text-primary-text font-medium shadow-xs'
                : 'text-app-text-secondary hover:bg-surface-hover hover:text-app-text'
            }`}
            title={t.document.addLine}
            aria-label={t.document.addLine}
            aria-pressed={mode === 'draw'}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <span className="w-px h-4 bg-border" aria-hidden="true" />

        {/* Zoom Controls */}
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onZoomOut}
            className="inline-flex items-center justify-center w-8 h-8 rounded text-app-text-secondary hover:bg-surface-hover hover:text-app-text transition-colors"
            title={t.document.zoomOut}
            aria-label={t.document.zoomOut}
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-app-text-secondary px-1 min-w-[38px] text-center select-none">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={onZoomIn}
            className="inline-flex items-center justify-center w-8 h-8 rounded text-app-text-secondary hover:bg-surface-hover hover:text-app-text transition-colors"
            title={t.document.zoomIn}
            aria-label={t.document.zoomIn}
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onZoomFit}
            className="inline-flex items-center justify-center w-8 h-8 rounded text-app-text-secondary hover:bg-surface-hover hover:text-app-text transition-colors ml-0.5"
            title={t.document.fitToScreen}
            aria-label={t.document.fitToScreen}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <span className="w-px h-4 bg-border" aria-hidden="true" />

        {/* Undo Action */}
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          className="inline-flex items-center justify-center w-8 h-8 rounded text-app-text-secondary hover:bg-surface-hover hover:text-app-text disabled:opacity-35 disabled:pointer-events-none transition-colors"
          title={`${t.document.undo} (Ctrl+Z)`}
          aria-label={`${t.document.undo} (Ctrl+Z)`}
        >
          <Undo2 className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Selected Line Inspection & Crop Preview */}
      <div className="p-3 border-b border-border bg-surface/40 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-app-text-secondary">
            {selectedRegion ? `Строка #${selectedRegion.readingOrder + 1}` : t.document.selectedLine}
          </span>
          {selectedRegion && (
            <span className="text-[11px] font-mono text-app-text-secondary">
              {selectedRegion.geometry.width} × {selectedRegion.geometry.height} px
            </span>
          )}
        </div>

        {/* Live Crop Canvas Preview */}
        <LineCropPreview
          imageUrl={imageUrl}
          imageWidth={imageWidth}
          imageHeight={imageHeight}
          geometry={selectedRegion ? selectedRegion.geometry : null}
          className="mb-2.5"
        />

        {/* Selected Line Action Buttons */}
        {selectedRegion ? (
          <div className="flex items-center justify-between gap-1.5 pt-1">
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onMoveReadingOrder(selectedRegion.id, 'up')}
                disabled={!canMoveUp}
                title={t.document.moveUp}
              >
                <ChevronUp className="w-3.5 h-3.5 mr-0.5" />
                {t.document.moveUp}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => onMoveReadingOrder(selectedRegion.id, 'down')}
                disabled={!canMoveDown}
                title={t.document.moveDown}
              >
                <ChevronDown className="w-3.5 h-3.5 mr-0.5" />
                {t.document.moveDown}
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs text-status-danger border-status-danger/30 hover:bg-status-danger/10"
              onClick={() => onDeleteRegion(selectedRegion.id)}
              title={t.document.deleteLine}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <p className="text-xs text-app-text-secondary leading-relaxed m-0">
            Кликните по рамке строки на холсте или нажмите <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[10px] font-mono">+</kbd> чтобы нарисовать новую строку.
          </p>
        )}
      </div>

      {/* 3. Lines List Summary */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2">
        <div className="flex items-center justify-between px-1.5 py-1 mb-1 text-[11px] font-medium text-app-text-secondary uppercase tracking-wider">
          <span className="flex items-center gap-1">
            <Layers className="w-3.5 h-3.5" />
            {t.document.allLines}
          </span>
          <span>{regions.length}</span>
        </div>

        {regions.length === 0 ? (
          <div className="p-4 text-center text-xs text-app-text-secondary">
            {t.document.noLinesYet}
          </div>
        ) : (
          <ul className="space-y-1 m-0 p-0 list-none">
            {regions.map((region, idx) => {
              const isSelected = region.id === selectedRegionId;
              return (
                <li key={region.id}>
                  <button
                    type="button"
                    onClick={() => onSelectRegion(region.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs transition-colors text-left ${
                      isSelected
                        ? 'bg-focus/10 text-focus font-medium border border-focus/30'
                        : 'text-app-text hover:bg-surface-hover border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10px] font-semibold opacity-70 w-5">
                        #{idx + 1}
                      </span>
                      <span className="truncate">
                        Строка {idx + 1}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-app-text-secondary shrink-0">
                      {region.geometry.width}×{region.geometry.height}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 4. Footer Primary CTA: Proceed to Recognition */}
      <div className="p-3 border-t border-border bg-surface shrink-0">
        <Button
          variant="primary"
          size="md"
          className="w-full justify-center"
          disabled={regions.length === 0}
          isLoading={isSaving}
          onClick={onSaveAndRecognize}
        >
          {t.document.recognizeLinesAction} ({regions.length})
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>
    </aside>
  );
}
