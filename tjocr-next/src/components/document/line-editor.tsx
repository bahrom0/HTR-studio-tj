'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RegionDto } from '@/domain/types';

export interface LineEditorProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  regions: readonly RegionDto[];
  selectedRegionId: string | null;
  onSelectRegion: (id: string | null) => void;
  onChangeRegions: (regions: RegionDto[]) => void;
  mode: 'select' | 'draw';
  zoom: number;
  onZoomChange: (zoom: number) => void;
  pan: { x: number; y: number };
  onPanChange: (pan: { x: number; y: number }) => void;
  className?: string;
}

type DragAction =
  | { type: 'pan'; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { type: 'draw'; startX: number; startY: number; currentX: number; currentY: number }
  | { type: 'move'; regionId: string; startImgX: number; startImgY: number; initialX: number; initialY: number }
  | {
      type: 'resize';
      regionId: string;
      handle: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
      startImgX: number;
      startImgY: number;
      initialGeometry: { x: number; y: number; width: number; height: number };
    };

export function LineEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  regions,
  selectedRegionId,
  onSelectRegion,
  onChangeRegions,
  mode,
  zoom,
  onZoomChange,
  pan,
  onPanChange,
  className = '',
}: Readonly<LineEditorProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragAction, setDragAction] = useState<DragAction | null>(null);
  const [hoveredRegionId, setHoveredRegionId] = useState<string | null>(null);
  const [spacePressed, setSpacePressed] = useState(false);

  // Safety fallback for zero or negative dimensions
  const safeW = imageWidth > 0 ? imageWidth : 1000;
  const safeH = imageHeight > 0 ? imageHeight : 1000;

  // Convert client viewport coordinates to normalized image pixel coordinates
  const clientToImageCoords = useCallback(
    (clientX: number, clientY: number) => {
      if (!containerRef.current) return { x: 0, y: 0 };
      const rect = containerRef.current.getBoundingClientRect();
      const vx = clientX - rect.left - pan.x;
      const vy = clientY - rect.top - pan.y;
      const imgX = vx / zoom;
      const imgY = vy / zoom;
      return {
        x: Math.max(0, Math.min(safeW, imgX)),
        y: Math.max(0, Math.min(safeH, imgY)),
      };
    },
    [pan.x, pan.y, zoom, safeW, safeH],
  );

  // Handle keyboard spacebar for panning
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !spacePressed && (e.target as HTMLElement)?.tagName !== 'INPUT') {
        setSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [spacePressed]);

  // Pointer Down Handler
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 1) return; // Left or middle click only
    const target = e.target as HTMLElement | SVGElement;
    const { clientX, clientY } = e;
    const { x: imgX, y: imgY } = clientToImageCoords(clientX, clientY);

    // Pan with spacebar or middle mouse button
    if (spacePressed || e.button === 1) {
      e.preventDefault();
      setDragAction({
        type: 'pan',
        startClientX: clientX,
        startClientY: clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      });
      return;
    }

    // Check if clicked on a resize handle
    const handleAttr = target.getAttribute?.('data-handle');
    if (handleAttr && selectedRegionId) {
      e.stopPropagation();
      const selected = regions.find((r) => r.id === selectedRegionId);
      if (selected) {
        setDragAction({
          type: 'resize',
          regionId: selectedRegionId,
          handle: handleAttr as 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w',
          startImgX: imgX,
          startImgY: imgY,
          initialGeometry: { ...selected.geometry },
        });
        return;
      }
    }

    // Check if clicked on a region box
    const regionIdAttr = target.getAttribute?.('data-region-id');
    if (regionIdAttr && mode === 'select') {
      e.stopPropagation();
      onSelectRegion(regionIdAttr);
      const clickedRegion = regions.find((r) => r.id === regionIdAttr);
      if (clickedRegion) {
        setDragAction({
          type: 'move',
          regionId: regionIdAttr,
          startImgX: imgX,
          startImgY: imgY,
          initialX: clickedRegion.geometry.x,
          initialY: clickedRegion.geometry.y,
        });
      }
      return;
    }

    // Otherwise, in draw mode (or clicking empty background in draw mode)
    if (mode === 'draw') {
      e.preventDefault();
      setDragAction({
        type: 'draw',
        startX: imgX,
        startY: imgY,
        currentX: imgX,
        currentY: imgY,
      });
      return;
    }

    // In select mode clicking background: deselect and start pan
    onSelectRegion(null);
    setDragAction({
      type: 'pan',
      startClientX: clientX,
      startClientY: clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    });
  };

  // Pointer Move Handler
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragAction) return;
    const { clientX, clientY } = e;
    const { x: imgX, y: imgY } = clientToImageCoords(clientX, clientY);

    if (dragAction.type === 'pan') {
      const dx = clientX - dragAction.startClientX;
      const dy = clientY - dragAction.startClientY;
      onPanChange({
        x: dragAction.startPanX + dx,
        y: dragAction.startPanY + dy,
      });
    } else if (dragAction.type === 'draw') {
      setDragAction({
        ...dragAction,
        currentX: imgX,
        currentY: imgY,
      });
    } else if (dragAction.type === 'move') {
      const dx = imgX - dragAction.startImgX;
      const dy = imgY - dragAction.startImgY;
      const targetRegion = regions.find((r) => r.id === dragAction.regionId);
      if (!targetRegion) return;

      const newX = Math.max(
        0,
        Math.min(safeW - targetRegion.geometry.width, dragAction.initialX + dx),
      );
      const newY = Math.max(
        0,
        Math.min(safeH - targetRegion.geometry.height, dragAction.initialY + dy),
      );

      const updated = regions.map((r) =>
        r.id === dragAction.regionId
          ? { ...r, geometry: { ...r.geometry, x: Math.round(newX), y: Math.round(newY) } }
          : r,
      );
      onChangeRegions(updated);
    } else if (dragAction.type === 'resize') {
      const { handle, initialGeometry } = dragAction;
      const dx = imgX - dragAction.startImgX;
      const dy = imgY - dragAction.startImgY;

      let { x, y, width, height } = initialGeometry;

      if (handle.includes('w')) {
        const potentialW = initialGeometry.width - dx;
        if (potentialW >= 8 && initialGeometry.x + dx >= 0) {
          x = initialGeometry.x + dx;
          width = potentialW;
        }
      }
      if (handle.includes('e')) {
        const potentialW = initialGeometry.width + dx;
        if (potentialW >= 8 && initialGeometry.x + potentialW <= safeW) {
          width = potentialW;
        }
      }
      if (handle.includes('n')) {
        const potentialH = initialGeometry.height - dy;
        if (potentialH >= 8 && initialGeometry.y + dy >= 0) {
          y = initialGeometry.y + dy;
          height = potentialH;
        }
      }
      if (handle.includes('s')) {
        const potentialH = initialGeometry.height + dy;
        if (potentialH >= 8 && initialGeometry.y + potentialH <= safeH) {
          height = potentialH;
        }
      }

      const updated = regions.map((r) =>
        r.id === dragAction.regionId
          ? {
              ...r,
              geometry: {
                ...r.geometry,
                x: Math.round(x),
                y: Math.round(y),
                width: Math.round(width),
                height: Math.round(height),
              },
            }
          : r,
      );
      onChangeRegions(updated);
    }
  };

  // Pointer Up Handler
  const handlePointerUp = () => {
    if (!dragAction) return;

    if (dragAction.type === 'draw') {
      const minX = Math.min(dragAction.startX, dragAction.currentX);
      const minY = Math.min(dragAction.startY, dragAction.currentY);
      const width = Math.abs(dragAction.currentX - dragAction.startX);
      const height = Math.abs(dragAction.currentY - dragAction.startY);

      // Only add region if it's large enough (threshold 8x8 px)
      if (width >= 8 && height >= 8) {
        const newRegionId = `reg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const newRegion: RegionDto = {
          id: newRegionId,
          revisionId: regions[0]?.revisionId || '',
          readingOrder: regions.length,
          geometry: {
            x: Math.round(minX),
            y: Math.round(minY),
            width: Math.round(width),
            height: Math.round(height),
          },
          excluded: false,
          createdAt: new Date().toISOString(),
        };

        const updated = [...regions, newRegion];
        onChangeRegions(updated);
        onSelectRegion(newRegionId);
      }
    }

    setDragAction(null);
  };

  // Wheel zoom handler with Ctrl or trackpad pinch
  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newZoom = Math.max(0.2, Math.min(4.0, zoom * zoomFactor));

      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Zoom centered around mouse pointer
        const newPanX = mouseX - (mouseX - pan.x) * (newZoom / zoom);
        const newPanY = mouseY - (mouseY - pan.y) * (newZoom / zoom);

        onPanChange({ x: newPanX, y: newPanY });
      }

      onZoomChange(newZoom);
    } else {
      // Regular wheel scrolls the pan
      onPanChange({
        x: pan.x - e.deltaX,
        y: pan.y - e.deltaY,
      });
    }
  };

  // Selected region helper
  const selectedRegion = regions.find((r) => r.id === selectedRegionId);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden bg-surface select-none touch-none ${className}`}
      style={{
        cursor: spacePressed
          ? dragAction?.type === 'pan'
            ? 'grabbing'
            : 'grab'
          : mode === 'draw'
            ? 'crosshair'
            : dragAction?.type === 'pan'
              ? 'grabbing'
              : 'default',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* Transformed Stage Layer */}
      <div
        className="absolute left-0 top-0 transition-none will-change-transform"
        style={{
          width: `${safeW}px`,
          height: `${safeH}px`,
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        {/* Document scan image */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={imageUrl}
          alt="Документ"
          width={safeW}
          height={safeH}
          draggable={false}
          className="block w-full h-full object-contain pointer-events-none select-none"
        />

        {/* SVG Annotations & Handles Layer */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-auto"
          viewBox={`0 0 ${safeW} ${safeH}`}
        >
          {/* 1. Existing Regions */}
          {regions.map((region) => {
            const isSelected = selectedRegionId === region.id;
            const isHovered = hoveredRegionId === region.id;
            const { x, y, width, height } = region.geometry;

            const strokeColor = isSelected
              ? 'var(--color-focus, #005fcc)'
              : isHovered
                ? '#171717'
                : 'rgba(23, 23, 23, 0.72)';

            const fillColor = isSelected
              ? 'rgba(0, 95, 204, 0.12)'
              : isHovered
                ? 'rgba(0, 0, 0, 0.05)'
                : 'transparent';

            return (
              <g
                key={region.id}
                data-region-id={region.id}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredRegionId(region.id)}
                onMouseLeave={() => setHoveredRegionId(null)}
              >
                {/* Main Box Rect */}
                <rect
                  data-region-id={region.id}
                  x={x}
                  y={y}
                  width={Math.max(4, width)}
                  height={Math.max(4, height)}
                  fill={fillColor}
                  stroke={strokeColor}
                  strokeWidth={(isSelected ? 2.5 : isHovered ? 2 : 1.2) / zoom}
                  strokeDasharray={region.excluded ? `${4 / zoom} ${2 / zoom}` : undefined}
                  rx={2 / zoom}
                />

                {/* Reading Order Badge */}
                <g pointerEvents="none">
                  <rect
                    x={x}
                    y={Math.max(0, y - 16 / zoom)}
                    width={Math.max(16 / zoom, (String(region.readingOrder + 1).length * 8 + 8) / zoom)}
                    height={15 / zoom}
                    fill={strokeColor}
                    rx={2 / zoom}
                  />
                  <text
                    x={x + 4 / zoom}
                    y={Math.max(11 / zoom, y - 4 / zoom)}
                    fontSize={10 / zoom}
                    fontFamily="var(--font-geist-mono), monospace"
                    fill="#FFFFFF"
                    fontWeight="600"
                  >
                    #{region.readingOrder + 1}
                  </text>
                </g>
              </g>
            );
          })}

          {/* 2. Interactive Resize Handles for Selected Region */}
          {selectedRegion && (
            <g className="cursor-default">
              {(() => {
                const { x, y, width, height } = selectedRegion.geometry;
                const visualSize = 9 / zoom;
                const touchSize = Math.max(26 / zoom, 20);
                const halfVisual = visualSize / 2;
                const halfTouch = touchSize / 2;

                const handles: Array<{
                  id: 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
                  x: number;
                  y: number;
                  cursor: string;
                }> = [
                  { id: 'nw', x: x, y: y, cursor: 'nwse-resize' },
                  { id: 'n', x: x + width / 2, y: y, cursor: 'ns-resize' },
                  { id: 'ne', x: x + width, y: y, cursor: 'nesw-resize' },
                  { id: 'e', x: x + width, y: y + height / 2, cursor: 'ew-resize' },
                  { id: 'se', x: x + width, y: y + height, cursor: 'nwse-resize' },
                  { id: 's', x: x + width / 2, y: y + height, cursor: 'ns-resize' },
                  { id: 'sw', x: x, y: y + height, cursor: 'nesw-resize' },
                  { id: 'w', x: x, y: y + height / 2, cursor: 'ew-resize' },
                ];

                return handles.map((h) => (
                  <g key={h.id}>
                    {/* Invisible large touch target */}
                    <rect
                      data-handle={h.id}
                      x={h.x - halfTouch}
                      y={h.y - halfTouch}
                      width={touchSize}
                      height={touchSize}
                      fill="transparent"
                      style={{ cursor: h.cursor }}
                    />
                    {/* Visible handle */}
                    <rect
                      x={h.x - halfVisual}
                      y={h.y - halfVisual}
                      width={visualSize}
                      height={visualSize}
                      fill="#FFFFFF"
                      stroke="var(--color-focus, #005fcc)"
                      strokeWidth={1.5 / zoom}
                      rx={1 / zoom}
                      pointerEvents="none"
                    />
                  </g>
                ));
              })()}
            </g>
          )}

          {/* 3. Draft Rectangle being drawn */}
          {dragAction?.type === 'draw' && (
            <g pointerEvents="none">
              <rect
                x={Math.min(dragAction.startX, dragAction.currentX)}
                y={Math.min(dragAction.startY, dragAction.currentY)}
                width={Math.abs(dragAction.currentX - dragAction.startX)}
                height={Math.abs(dragAction.currentY - dragAction.startY)}
                fill="rgba(0, 95, 204, 0.15)"
                stroke="var(--color-focus, #005fcc)"
                strokeWidth={2 / zoom}
                strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                rx={2 / zoom}
              />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
