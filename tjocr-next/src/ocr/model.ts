import type { OCRDevice, OCRModelInfo } from './types';

export function createTrOCRModelInfo(status: OCRModelInfo['status'], device: OCRDevice): OCRModelInfo {
  return {
    family: 'TrOCR',
    engine: 'trocr',
    task: 'handwritten-text-recognition',
    language: 'tg',
    runtime: 'OCRRuntime',
    runtimeId: 'local-ocr-runtime',
    device: { kind: 'OCRDevice', target: device },
    preprocessing: ['ImagePreprocessor', 'orientation-preserved', 'line-crop'],
    tokenizer: { name: 'OCRTokenizer', normalization: 'preserve-tajik-cyrillic' },
    status,
  };
}
