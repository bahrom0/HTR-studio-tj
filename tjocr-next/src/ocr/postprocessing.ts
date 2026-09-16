import { HttpError } from '@/server/security/request';
import type { CropInput, RecognizedLine } from './types';

export class OCRTokenizer {
  normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }
}

export function matchRecognitionResultSet(crops: CropInput[], lines: unknown, tokenizer: OCRTokenizer): RecognizedLine[] {
  if (!Array.isArray(lines) || lines.length !== crops.length) {
    throw new HttpError('Recognition request failed.', 'OCR_INVALID_RESULT_SET', 502, true);
  }
  const expected = new Set(crops.map((crop) => crop.lineIndex));
  const received = new Set<number>();
  for (const line of lines as Array<{ index?: unknown }>) {
    if (typeof line?.index !== 'number' || !expected.has(line.index) || received.has(line.index)) {
      throw new HttpError('Recognition request failed.', 'OCR_INVALID_RESULT_SET', 502, true);
    }
    received.add(line.index);
  }
  return crops.map((crop) => {
    const match = (lines as Array<{ index: number; text?: unknown }>).find((line) => line.index === crop.lineIndex);
    const text = tokenizer.normalizeText(match?.text);
    return { lineIndex: crop.lineIndex, regionId: crop.regionId, text, status: text ? 'succeeded' : 'failed' };
  });
}
