import sharp from 'sharp';
import crypto from 'node:crypto';
import { HttpError } from '../security/request';

export interface NormalizedImageResult {
  normalizedBuffer: Buffer;
  normalizedWidth: number;
  normalizedHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceFormat: string;
  sourceChecksum: string;
  normalizedChecksum: string;
}

export interface NormalizeOptions {
  rotateDegrees?: number;
  maxEdge?: number;
}

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MAX_DECODED_PIXELS = 40_000_000;
const DEFAULT_MAX_EDGE = 2048;

function computeSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Validates the image buffer format, decoded dimensions, strips EXIF metadata,
 * applies orientation/rotation, and outputs a normalized lossless PNG.
 */
export async function validateAndNormalizeImage(
  buffer: Buffer,
  options?: NormalizeOptions,
): Promise<NormalizedImageResult> {
  if (!buffer || buffer.length === 0) {
    throw new HttpError('Файл пуст.', 'EMPTY_IMAGE_FILE', 400, false);
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new HttpError(
      'Не удалось прочитать изображение. Возможно, файл повреждён.',
      'INVALID_IMAGE_FILE',
      422,
      false,
    );
  }

  const format = metadata.format?.toLowerCase();
  if (!format || !ALLOWED_FORMATS.has(format)) {
    throw new HttpError(
      'Поддерживаются только форматы JPEG, PNG и WebP.',
      'UNSUPPORTED_IMAGE_FORMAT',
      415,
      false,
    );
  }

  const sourceWidth = metadata.width || 0;
  const sourceHeight = metadata.height || 0;
  if (sourceWidth < 2 || sourceHeight < 2) {
    throw new HttpError(
      'Разрешение изображения слишком мало (минимум 2×2 пикселя).',
      'IMAGE_TOO_SMALL',
      422,
      false,
    );
  }

  if (sourceWidth * sourceHeight > MAX_DECODED_PIXELS) {
    throw new HttpError(
      'Разрешение изображения слишком велико (максимум 40 мегапикселей).',
      'IMAGE_DIMENSIONS_TOO_LARGE',
      413,
      false,
    );
  }

  const maxEdge = options?.maxEdge || DEFAULT_MAX_EDGE;
  const rotateDegrees = options?.rotateDegrees;

  try {
    let pipeline = sharp(buffer);

    // Auto-orient based on EXIF, or apply user rotation
    if (typeof rotateDegrees === 'number' && rotateDegrees !== 0) {
      const validAngle = ((rotateDegrees % 360) + 360) % 360;
      pipeline = pipeline.rotate(validAngle);
    } else {
      pipeline = pipeline.rotate();
    }

    pipeline = pipeline
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .png({
        compressionLevel: 8,
      });

    const { data: normalizedBuffer, info } = await pipeline.toBuffer({ resolveWithObject: true });

    return {
      normalizedBuffer,
      normalizedWidth: info.width,
      normalizedHeight: info.height,
      sourceWidth,
      sourceHeight,
      sourceFormat: format,
      sourceChecksum: computeSha256(buffer),
      normalizedChecksum: computeSha256(normalizedBuffer),
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      'Не удалось нормализовать изображение страницы.',
      'IMAGE_NORMALIZATION_FAILED',
      422,
      false,
    );
  }
}
