import type { RegionGeometry } from '@/domain/types';

export type OCRDevice = 'auto' | 'cpu' | 'accelerator';
export type OCRRuntimeState = 'idle' | 'initializing' | 'ready' | 'unavailable';

export interface CropInput {
  lineIndex: number;
  regionId: string;
  imageBuffer: Buffer;
  mimeType: string;
}

export interface RecognizedLine {
  lineIndex: number;
  regionId: string;
  text: string;
  status: 'succeeded' | 'failed';
}

export interface LineDetectorInput {
  imageBuffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export interface DetectedLine {
  readingOrder: number;
  geometry: RegionGeometry;
}

export interface LayoutAnalysisInput {
  imageBuffer: Buffer;
  mimeType: string;
  regions: Array<{ index: number; x: number; y: number; width: number; height: number }>;
}

export interface OCRModelInfo {
  family: 'TrOCR';
  engine: 'trocr';
  task: 'handwritten-text-recognition';
  language: 'tg';
  runtime: 'OCRRuntime';
  runtimeId: 'local-ocr-runtime';
  device: { kind: 'OCRDevice'; target: OCRDevice };
  preprocessing: string[];
  tokenizer: { name: 'OCRTokenizer'; normalization: 'preserve-tajik-cyrillic' };
  status: 'ready' | 'unavailable';
}

export interface OCRHealth {
  status: 'ready' | 'unavailable';
  model: OCRModelInfo;
}

export interface OCRRuntimeConfig {
  backend: string;
  model: string;
  device: OCRDevice;
  batchSize: number;
  batchConcurrency: number;
  timeoutMs: number;
  maxOutputTokens: number;
  reasoningEffort: 'low' | 'medium' | 'high';
}
