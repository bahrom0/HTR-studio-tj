import { HttpError } from '@/server/security/request';
import type { OCRRuntimeConfig } from '../types';

type ContentPart = { type: 'text' | 'image_url'; text?: string; image_url?: { url: string } };

interface InternalTransportConfig {
  baseUrl: string;
  apiKey?: string;
  recognitionModel?: string;
  detectionModel?: string;
  route?: string;
  maxLatencySeconds: number;
  minThroughput: number;
}

function readInternalTransportConfig(): InternalTransportConfig {
  // Legacy variables are intentionally read only at this implementation boundary
  // so existing deployments continue to work while callers use OCR_* runtime names.
  return {
    baseUrl: process.env.OCR_PROVIDER_URL || process.env.OCR_API_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.OCR_PROVIDER_API_KEY || process.env.OCR_API_KEY || process.env.OPENROUTER_API_KEY,
    recognitionModel: process.env.OCR_PROVIDER_MODEL || process.env.RECOGNIZER_MODEL_ID || process.env.OCR_MODEL_ID || process.env.HTR_OCR_MODEL,
    detectionModel: process.env.OCR_PROVIDER_DETECTOR_MODEL || process.env.DETECTOR_MODEL_ID || process.env.OCR_PROVIDER_MODEL || process.env.OCR_MODEL_ID || process.env.HTR_OCR_MODEL,
    route: process.env.OCR_PROVIDER_ROUTE || process.env.OPENROUTER_OCR_PROVIDER,
    maxLatencySeconds: Number(process.env.OCR_PROVIDER_MAX_LATENCY_SECONDS || process.env.OPENROUTER_PREFERRED_MAX_LATENCY_SECONDS || 5),
    minThroughput: Number(process.env.OCR_PROVIDER_MIN_THROUGHPUT || process.env.OPENROUTER_PREFERRED_MIN_THROUGHPUT || 60),
  };
}

/**
 * The only file that knows the current transport protocol and internal inference
 * deployment. It never returns an upstream body, URL, key, model identifier, or
 * routing detail to callers.
 */
export class InternalProviderImplementation {
  constructor(private readonly runtimeConfig: OCRRuntimeConfig) {}

  assertConfigured(kind: 'recognition' | 'detection' = 'recognition') {
    const config = readInternalTransportConfig();
    if (!config.apiKey || !(kind === 'recognition' ? config.recognitionModel : config.detectionModel)) {
      throw new HttpError('OCR runtime initialization failed.', 'OCR_RUNTIME_INITIALIZATION_FAILED', 503, false);
    }
  }

  async requestJson(input: {
    operation: 'recognition' | 'detection' | 'layout';
    prompt: string;
    content: ContentPart[];
    idempotencyKey?: string;
    maxOutputTokens?: number;
  }): Promise<unknown> {
    const config = readInternalTransportConfig();
    const usesDetectionModel = input.operation === 'detection';
    const model = usesDetectionModel ? config.detectionModel : config.recognitionModel;
    this.assertConfigured(usesDetectionModel ? 'detection' : 'recognition');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.runtimeConfig.timeoutMs);
    const startedAt = performance.now();
    let response: Response;

    try {
      response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
          ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          ...(input.maxOutputTokens ? { max_tokens: input.maxOutputTokens } : {}),
          ...(input.operation !== 'detection' ? { reasoning: { effort: input.operation === 'layout' ? 'low' : this.runtimeConfig.reasoningEffort } } : {}),
          ...(input.operation !== 'detection' && config.route ? {
            provider: {
              order: [config.route],
              only: [config.route],
              allow_fallbacks: false,
              sort: { by: 'latency' },
              preferred_max_latency: { p50: config.maxLatencySeconds },
              preferred_min_throughput: { p50: config.minThroughput },
            },
          } : {}),
          ...(input.operation !== 'detection' ? { response_format: { type: 'json_object' } } : {}),
          messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }, ...input.content] }],
        }),
      });
    } catch {
      if (controller.signal.aborted) {
        throw new HttpError('Inference backend timeout.', 'OCR_INFERENCE_TIMEOUT', 504, true);
      }
      throw new HttpError('OCR inference unavailable.', 'OCR_INFERENCE_UNAVAILABLE', 502, true);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new HttpError('OCR inference unavailable.', 'OCR_INFERENCE_UNAVAILABLE', response.status >= 500 ? 502 : 400, response.status >= 500);
    }

    const data = await response.json().catch(() => null);
    const content = data?.choices?.[0]?.message?.content;
    const usage = data?.usage || {};
    console.info('[ocr:runtime]', {
      operation: input.operation,
      responseMs: Math.round(performance.now() - startedAt),
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      reasoningTokens: usage.reasoning_tokens ?? null,
      cachedTokens: usage.cached_tokens ?? null,
    });
    if (typeof content !== 'string') {
      throw new HttpError('Recognition request failed.', 'OCR_EMPTY_RESPONSE', 502, true);
    }
    try {
      return JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
    } catch {
      throw new HttpError('Recognition request failed.', 'OCR_INVALID_RESPONSE', 502, true);
    }
  }
}
