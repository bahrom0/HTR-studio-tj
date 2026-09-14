import { HttpError } from '../security/request';
import { RegionGeometry } from '../../domain/types';

export interface DetectedLine {
  readingOrder: number;
  geometry: RegionGeometry;
}

export interface LineDetectorInput {
  imageBuffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export interface LineDetector {
  detect(input: LineDetectorInput): Promise<DetectedLine[]>;
}

/**
 * RemoteLineDetector connects to the configured external vision/OCR API
 * using server-side credentials and model configuration.
 * Coordinates are normalized to the page image pixel system.
 */
export class RemoteLineDetector implements LineDetector {
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

  async detect(input: LineDetectorInput): Promise<DetectedLine[]> {
    if (!this.apiKey) {
      throw new HttpError(
        'Ключ внешнего сервиса детекции не настроен на сервере.',
        'DETECTOR_API_KEY_MISSING',
        503,
        false,
      );
    }
    if (!this.modelId) {
      throw new HttpError(
        'Модель детектора строк не настроена на сервере.',
        'DETECTOR_MODEL_MISSING',
        503,
        false,
      );
    }

    const base64Image = input.imageBuffer.toString('base64');
    const prompt = [
      'Find every visible handwritten or printed Tajik Cyrillic text line on this page.',
      'Return one tight axis-aligned box per physical text line, in natural top-to-bottom reading order.',
      'Do not merge several lines into one box. Ignore page borders, grid lines, shadows, and decorations.',
      'Coordinates must be integers normalized to 0..1000 in the exact order [ymin, xmin, ymax, xmax].',
      'If the page contains no text lines, return {"lines":[]}.',
      'Return JSON only in this exact shape: {"lines":[{"index":0,"box_2d":[ymin,xmin,ymax,xmax]}]}.',
    ].join(' ');

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
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${base64Image}` },
                },
              ],
            },
          ],
        }),
      });
    } catch (networkError) {
      throw new HttpError(
        'Внешний сервис детекции строк недоступен.',
        'DETECTION_NETWORK_ERROR',
        502,
        true,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new HttpError(
        `Внешний сервис детекции строк вернул ошибку (${response.status}): ${errorBody.slice(0, 200)}`,
        'DETECTION_UPSTREAM_ERROR',
        502,
        true,
      );
    }

    const data = await response.json().catch(() => null);
    const rawContent = data?.choices?.[0]?.message?.content;
    if (!rawContent || typeof rawContent !== 'string') {
      throw new HttpError('Пустой ответ сервиса детекции строк.', 'DETECTION_EMPTY_RESPONSE', 502, true);
    }

    // Strip markdown formatting if returned
    const cleaned = rawContent
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    let parsed: { lines?: Array<{ index?: number; box_2d?: number[]; box?: number[]; bbox?: number[] }> };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      throw new HttpError('Некорректный JSON от сервиса детекции строк.', 'DETECTION_INVALID_JSON', 502, true);
    }

    const rawLines = Array.isArray(parsed?.lines) ? parsed.lines : [];
    if (rawLines.length === 0) {
      return []; // Zero lines found state
    }

    if (rawLines.length > 200) {
      throw new HttpError(
        'Превышен допустимый лимит строк на странице (максимум 200).',
        'DETECTION_LINE_LIMIT_EXCEEDED',
        422,
        false,
      );
    }

    return rawLines.map((line, fallbackIndex) => {
      const rawBox = line.box_2d || line.box || line.bbox;
      if (
        !Array.isArray(rawBox) ||
        rawBox.length !== 4 ||
        !rawBox.every((val) => typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 1000)
      ) {
        throw new HttpError('Некорректные координаты строки в ответе детектора.', 'DETECTION_INVALID_COORDINATES', 502, true);
      }

      const [ymin, xmin, ymax, xmax] = rawBox;
      if (ymin >= ymax || xmin >= xmax) {
        throw new HttpError('Вырожденный прямоугольник строки в ответе детектора.', 'DETECTION_DEGENERATE_BOX', 502, true);
      }

      const areaFraction = ((ymax - ymin) / 1000) * ((xmax - xmin) / 1000);
      if (areaFraction > 0.85) {
        throw new HttpError('Слишком большая область вместо строки текста.', 'DETECTION_BOX_TOO_LARGE', 502, true);
      }

      // Convert 0..1000 into float pixels of the normalized image
      const x = Math.round(((xmin / 1000) * input.width) * 100) / 100;
      const y = Math.round(((ymin / 1000) * input.height) * 100) / 100;
      const width = Math.round((((xmax - xmin) / 1000) * input.width) * 100) / 100;
      const height = Math.round((((ymax - ymin) / 1000) * input.height) * 100) / 100;

      const readingOrder = typeof line.index === 'number' && Number.isInteger(line.index)
        ? line.index
        : fallbackIndex;

      return {
        readingOrder,
        geometry: {
          x,
          y,
          width,
          height,
          polygon: [
            { x, y },
            { x: x + width, y },
            { x: x + width, y: y + height },
            { x, y: y + height },
          ],
        },
      };
    });
  }
}
