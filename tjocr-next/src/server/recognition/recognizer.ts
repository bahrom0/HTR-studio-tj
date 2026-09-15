import { HttpError } from '../security/request';

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

export interface TextRecognizer {
  recognizeBatch(crops: CropInput[], idempotencyKey?: string): Promise<RecognizedLine[]>;
}

/**
 * RemoteTextRecognizer connects to the configured external vision/OCR API
 * and sends batches of text line crops for transcription into Tajik Cyrillic.
 */
export class RemoteTextRecognizer implements TextRecognizer {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly modelId: string;
  private readonly appUrl: string;
  private readonly timeoutMs: number;
  private readonly maxOutputTokens: number;
  private readonly reasoningEffort: 'low' | 'medium' | 'high';
  private readonly openRouterRouting: { provider: string; maxLatencySeconds: number; minThroughput: number } | null;

  constructor(
    baseUrl: string,
    apiKey: string,
    modelId: string,
    appUrl: string = 'http://localhost:3000',
    options: {
      timeoutMs?: number;
      maxOutputTokens?: number;
      reasoningEffort?: 'low' | 'medium' | 'high';
      openRouterRouting?: { provider: string; maxLatencySeconds: number; minThroughput: number };
    } = {},
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.modelId = modelId;
    this.appUrl = appUrl;
    this.timeoutMs = options.timeoutMs || 20_000;
    this.maxOutputTokens = options.maxOutputTokens || 1_024;
    this.reasoningEffort = options.reasoningEffort || 'low';
    this.openRouterRouting = new URL(this.baseUrl).hostname.endsWith('openrouter.ai')
      ? options.openRouterRouting || { provider: 'google-ai-studio/flex', maxLatencySeconds: 5, minThroughput: 60 }
      : null;
  }

  async recognizeBatch(crops: CropInput[], idempotencyKey?: string): Promise<RecognizedLine[]> {
    if (crops.length === 0) {
      return [];
    }

    if (!this.apiKey) {
      throw new HttpError(
        'Ключ внешнего сервиса распознавания не настроен на сервере.',
        'RECOGNIZER_API_KEY_MISSING',
        503,
        false,
      );
    }
    if (!this.modelId) {
      throw new HttpError(
        'Модель распознавания текста не настроена на сервере.',
        'RECOGNIZER_MODEL_MISSING',
        503,
        false,
      );
    }

    const systemPrompt = [
      'Transcribe every supplied image region as Tajik Cyrillic text.',
      'A region may contain one or several text lines: transcribe ALL visible lines from top to bottom',
      'and join lines with the newline character \\n inside the text value.',
      'Never omit a second line. Use the Tajik letters ғ, ӣ, қ, ӯ, ҳ, ҷ whenever they are present;',
      'do not replace them with г, и, к, у, х, ж. Preserve punctuation, spelling, digits, and paragraph line breaks.',
      'Never invent unreadable text. Return one item for every supplied region, using exactly its supplied index.',
      'Output JSON only in this exact shape: {"lines":[{"index":0,"text":"..."}]}',
    ].join(' ');

    const contentParts: Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: systemPrompt },
    ];

    for (const crop of crops) {
      const base64 = crop.imageBuffer.toString('base64');
      contentParts.push({
        type: 'text',
        text: `Image region index=${crop.lineIndex}:`,
      });
      contentParts.push({
        type: 'image_url',
        image_url: { url: `data:${crop.mimeType || 'image/png'};base64,${base64}` },
      });
    }

    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let response: Response;
    const requestStartedAt = performance.now();
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), this.timeoutMs);

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        signal: abort.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.appUrl,
        'X-Title': 'Tajik HTR Studio',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        body: JSON.stringify({
          model: this.modelId,
          temperature: 0,
          max_tokens: this.maxOutputTokens,
          reasoning: { effort: this.reasoningEffort },
          ...(this.openRouterRouting ? {
            provider: {
              order: [this.openRouterRouting.provider],
              only: [this.openRouterRouting.provider],
              allow_fallbacks: false,
              sort: { by: 'latency' },
              preferred_max_latency: { p50: this.openRouterRouting.maxLatencySeconds },
              preferred_min_throughput: { p50: this.openRouterRouting.minThroughput },
            },
          } : {}),
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'user',
              content: contentParts,
            },
          ],
        }),
      });
    } catch (networkError) {
      if (abort.signal.aborted) {
        throw new HttpError(
          'Сервис распознавания не ответил за отведённое время.',
          'RECOGNIZER_TIMEOUT',
          504,
          true,
        );
      }
      throw new HttpError(
        'Сетевая ошибка при обращении к сервису распознавания.',
        'RECOGNIZER_NETWORK_ERROR',
        502,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new HttpError(
        'Сервис распознавания временно недоступен.',
        'RECOGNIZER_UPSTREAM_ERROR',
        response.status >= 500 ? 502 : 400,
        response.status >= 500,
      );
    }

    const rawData = await response.json().catch(() => null);
    // OpenRouter does not include its selected provider in our job schema.
    // Keep a safe timing record in server logs instead: no image data, OCR text,
    // API key, or request body is emitted. The generation id can be used with
    // OpenRouter's read-only generation metadata endpoint when investigating a
    // slow request.
    const usage = rawData?.usage || {};
    console.info('[ocr:openrouter]', {
      model: this.modelId,
      regions: crops.length,
      responseMs: Math.round(performance.now() - requestStartedAt),
      generationId: response.headers.get('x-generation-id') || rawData?.id || null,
      provider: rawData?.provider || response.headers.get('x-openrouter-provider') || null,
      promptTokens: usage.prompt_tokens ?? null,
      completionTokens: usage.completion_tokens ?? null,
      reasoningTokens: usage.reasoning_tokens ?? null,
      cachedTokens: usage.cached_tokens ?? null,
    });
    const content = rawData?.choices?.[0]?.message?.content;

    if (!content || typeof content !== 'string') {
      throw new HttpError(
        'Сервис распознавания вернул пустой или некорректный ответ.',
        'RECOGNIZER_EMPTY_RESPONSE',
        502,
        true,
      );
    }

    let parsedJson: { lines?: Array<{ index?: number; text?: string }> };
    try {
      const cleaned = content.replace(/^\`\`\`json\s*/i, '').replace(/^\`\`\`\s*/, '').replace(/\s*\`\`\`$/, '').trim();
      parsedJson = JSON.parse(cleaned);
    } catch {
      throw new HttpError(
        'Не удалось разобрать JSON-ответ модели распознавания.',
        'RECOGNIZER_INVALID_JSON',
        502,
        true,
      );
    }

    const linesList = parsedJson?.lines;
    if (!Array.isArray(linesList) || linesList.length !== crops.length) {
      throw new HttpError(
        'Сервис распознавания вернул неполный набор строк.',
        'RECOGNIZER_INVALID_RESULT_SET',
        502,
        true,
      );
    }

    const expectedIndexes = new Set(crops.map((crop) => crop.lineIndex));
    const receivedIndexes = new Set<number>();
    const results: RecognizedLine[] = [];

    for (const match of linesList) {
      if (typeof match?.index !== 'number' || !expectedIndexes.has(match.index) || receivedIndexes.has(match.index)) {
        throw new HttpError(
          'Сервис распознавания вернул некорректное соответствие строк.',
          'RECOGNIZER_INVALID_RESULT_SET',
          502,
          true,
        );
      }
      receivedIndexes.add(match.index);
    }

    for (const crop of crops) {
      const match = linesList.find((line) => line?.index === crop.lineIndex);

      const recognizedText = typeof match?.text === 'string' ? match.text.trim() : '';

      results.push({
        lineIndex: crop.lineIndex,
        regionId: crop.regionId,
        text: recognizedText,
        status: recognizedText.length > 0 ? 'succeeded' : 'failed',
      });
    }

    return results;
  }
}
