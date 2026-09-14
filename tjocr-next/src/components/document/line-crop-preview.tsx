'use client';

import React, { useEffect, useRef, useState } from 'react';
import { RegionGeometry } from '@/domain/types';

export interface LineCropPreviewProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  geometry: RegionGeometry | null;
  className?: string;
  maxHeight?: number;
}

export function LineCropPreview({
  imageUrl,
  imageWidth,
  imageHeight,
  geometry,
  className = '',
  maxHeight = 120,
}: Readonly<LineCropPreviewProps>) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Load and cache image
  useEffect(() => {
    if (!imageUrl) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;

    img.onload = () => {
      imgRef.current = img;
      setImageLoaded(true);
    };

    img.onerror = () => {
      setImageLoaded(false);
    };

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [imageUrl]);

  // Draw crop whenever geometry or imageLoaded changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgRef.current || !geometry) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y, width, height } = geometry;

    // Safety checks for crop bounds
    const safeX = Math.max(0, Math.min(imageWidth - 1, x));
    const safeY = Math.max(0, Math.min(imageHeight - 1, y));
    const safeW = Math.max(1, Math.min(imageWidth - safeX, width));
    const safeH = Math.max(1, Math.min(imageHeight - safeY, height));

    canvas.width = Math.round(safeW);
    canvas.height = Math.round(safeH);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(
      imgRef.current,
      safeX,
      safeY,
      safeW,
      safeH,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }, [geometry, imageLoaded, imageWidth, imageHeight]);

  if (!geometry) {
    return (
      <div
        className={`flex items-center justify-center rounded border border-dashed border-border bg-surface text-app-text-secondary text-xs p-4 text-center ${className}`}
        style={{ minHeight: '64px' }}
      >
        <span>Выберите строку на изображении</span>
      </div>
    );
  }

  return (
    <div
      className={`relative flex items-center justify-center rounded border border-border bg-surface overflow-hidden p-2 ${className}`}
      style={{ maxHeight: `${maxHeight}px` }}
    >
      <canvas
        ref={canvasRef}
        className="max-h-full max-w-full object-contain rounded select-none shadow-sm"
        style={{
          display: 'block',
          imageRendering: 'crisp-edges',
        }}
      />
    </div>
  );
}
