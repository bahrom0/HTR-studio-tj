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
  recognizeBatch(crops: CropInput[]): Promise<RecognizedLine[]>;
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

  constructor(
    baseUrl: string,
    apiKey: string,
    modelId: string,
    appUrl: string = 'http://localhost:3000',
  ) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.modelId = modelId;
    this.appUrl = appUrl;
  }

  async recognizeBatch(crops: CropInput[]): Promise<RecognizedLine[]> {
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
      'Never invent unreadable text. Return one item for every image region, in input order, using zero-based index.',
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

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': this.appUrl,
          'X-Title': 'Tajik HTR Studio',
        },
        body: JSON.stringify({
          model: this.modelId,
          temperature: 0,
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
      throw new HttpError(
        'Сетевая ошибка при обращении к сервису распознавания.',
        'RECOGNIZER_NETWORK_ERROR',
        502,
        true,
      );
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new HttpError(
        `Сервис распознавания вернул ошибку HTTP ${response.status}: ${errorText.slice(0, 200)}`,
        'RECOGNIZER_UPSTREAM_ERROR',
        response.status >= 500 ? 502 : 400,
        response.status >= 500,
      );
    }

    const rawData = await response.json().catch(() => null);
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
    const results: RecognizedLine[] = [];

    for (let i = 0; i < crops.length; i++) {
      const crop = crops[i];
      const match = Array.isArray(linesList)
        ? linesList.find((l) => l?.index === crop.lineIndex) || linesList[i]
        : undefined;

      const recognizedText = typeof match?.text === 'string' ? match.text.trim() : '';

      results.push({
        lineIndex: crop.lineIndex,
        regionId: crop.regionId,
        text: recognizedText,
        status: recognizedText.length >= 0 ? 'succeeded' : 'failed',
      });
    }

    return results;
  }
}
