import React, { useState } from 'react';
import { RegionDto } from '@/domain/types';
import { CachedImage } from '@/components/ui/cached-image';

export interface LineOverlayProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  regions: readonly RegionDto[];
  selectedRegionId?: string | null;
  onSelectRegion?: (regionId: string) => void;
  className?: string;
}

export const LineOverlay: React.FC<LineOverlayProps> = ({
  imageUrl,
  imageWidth,
  imageHeight,
  regions,
  selectedRegionId,
  onSelectRegion,
  className = '',
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const safeWidth = imageWidth > 0 ? imageWidth : 1000;
  const safeHeight = imageHeight > 0 ? imageHeight : 1000;

  return (
    <div
      className={`relative inline-block w-full max-w-full overflow-hidden rounded-md border border-border bg-surface ${className}`}
      style={{ aspectRatio: `${safeWidth} / ${safeHeight}` }}
    >
      {/* Normalized page image */}
      <CachedImage
        src={imageUrl}
        alt="Документ"
        className="block h-full w-full object-contain pointer-events-none select-none"
      />

      {/* SVG overlay for detected bounding boxes */}
      <svg
        className="absolute inset-0 h-full w-full pointer-events-auto"
        viewBox={`0 0 ${safeWidth} ${safeHeight}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {regions.map((region) => {
          const isSelected = selectedRegionId === region.id;
          const isHovered = hoveredId === region.id;
          const { x, y, width, height } = region.geometry;

          // Border and fill styling according to STYLE_SYSTEM.md (calm, precise)
          const strokeColor = isSelected
            ? 'var(--focus, #005FCC)'
            : isHovered
              ? '#171717'
              : 'rgba(23, 23, 23, 0.7)';

          const fillColor = isSelected
            ? 'rgba(0, 95, 204, 0.12)'
            : isHovered
              ? 'rgba(0, 0, 0, 0.06)'
              : 'transparent';

          return (
            <g
              key={region.id}
              className="cursor-pointer transition-colors"
              onMouseEnter={() => setHoveredId(region.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => onSelectRegion?.(region.id)}
            >
              <rect
                x={x}
                y={y}
                width={Math.max(4, width)}
                height={Math.max(4, height)}
                fill={fillColor}
                stroke={strokeColor}
                strokeWidth={isSelected || isHovered ? 2 : 1.2}
                strokeDasharray={region.excluded ? '4 2' : undefined}
                rx={2}
              />
              {/* Order number badge */}
              <rect
                x={x}
                y={Math.max(0, y - 14)}
                width={Math.max(16, String(region.readingOrder + 1).length * 8 + 8)}
                height={14}
                fill={strokeColor}
                rx={2}
              />
              <text
                x={x + 4}
                y={Math.max(10, y - 3)}
                fontSize={10}
                fontFamily="var(--font-geist-mono), monospace"
                fill="#FFFFFF"
                fontWeight="500"
              >
                {region.readingOrder + 1}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};
