import { z } from 'zod';
import type { OCRRuntimeConfig } from './types';

const runtimeSchema = z.object({
  device: z.enum(['auto', 'cpu', 'accelerator']).default('auto'),
  batchSize: z.coerce.number().int().min(1).max(16).default(4),
  batchConcurrency: z.coerce.number().int().min(1).max(2).default(2),
  timeoutMs: z.coerce.number().int().min(5_000).max(60_000).default(20_000),
  maxOutputTokens: z.coerce.number().int().min(128).max(4_096).default(1_024),
  reasoningEffort: z.enum(['low', 'medium', 'high']).default('low'),
});

let cachedConfig: OCRRuntimeConfig | undefined;

/** Public runtime configuration. Transport details intentionally stay in the internal adapter. */
export function getOCRRuntimeConfig(): OCRRuntimeConfig {
  if (cachedConfig) return cachedConfig;

  let supplied: unknown = {};
  if (process.env.OCR_RUNTIME_CONFIG) {
    try {
      supplied = JSON.parse(process.env.OCR_RUNTIME_CONFIG);
    } catch {
      throw new Error('OCR_RUNTIME_CONFIG must be valid JSON.');
    }
  }

  const parsed = runtimeSchema.safeParse({
    ...(typeof supplied === 'object' && supplied !== null ? supplied : {}),
    batchSize: process.env.OCR_BATCH_SIZE || process.env.RECOGNITION_BATCH_SIZE || (supplied as any)?.batchSize,
    batchConcurrency: process.env.OCR_BATCH_CONCURRENCY || process.env.RECOGNITION_BATCH_CONCURRENCY || (supplied as any)?.batchConcurrency,
  });
  if (!parsed.success) throw new Error('OCR runtime configuration is invalid.');

  cachedConfig = {
    backend: process.env.OCR_BACKEND || 'local-ocr-runtime',
    model: process.env.OCR_MODEL || 'tajik-trocr',
    ...parsed.data,
  };
  return cachedConfig;
}
