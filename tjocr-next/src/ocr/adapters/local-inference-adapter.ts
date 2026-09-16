import { HttpError } from '@/server/security/request';
import { matchRecognitionResultSet, OCRTokenizer } from '../postprocessing';
import type { CropInput, DetectedLine, LayoutAnalysisInput, LineDetectorInput, OCRRuntimeConfig, RecognizedLine } from '../types';
import { InternalProviderImplementation } from './internal-provider';

export class LocalInferenceAdapter {
  private readonly implementation: InternalProviderImplementation;
  private readonly tokenizer = new OCRTokenizer();

  constructor(private readonly config: OCRRuntimeConfig) {
    this.implementation = new InternalProviderImplementation(config);
  }

  assertConfigured() { this.implementation.assertConfigured(); }

  async recognizeBatch(crops: CropInput[], idempotencyKey?: string): Promise<RecognizedLine[]> {
    if (crops.length === 0) return [];
    const content: Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> = [];
    for (const crop of crops) {
      content.push({ type: 'text', text: `Image region index=${crop.lineIndex}:` });
      content.push({ type: 'image_url', image_url: { url: `data:${crop.mimeType || 'image/png'};base64,${crop.imageBuffer.toString('base64')}` } });
    }
    const response = await this.implementation.requestJson({
      operation: 'recognition', idempotencyKey, content,
      maxOutputTokens: this.config.maxOutputTokens,
      prompt: [
        'Transcribe every supplied image region as Tajik Cyrillic text.',
        'A region may contain one or several text lines: transcribe ALL visible lines from top to bottom and join lines with the newline character \\n inside the text value.',
        'Never omit a second line. Use the Tajik letters ғ, ӣ, қ, ӯ, ҳ, ҷ whenever they are present; do not replace them with г, и, к, у, х, ж.',
        'Preserve punctuation, spelling, digits, and paragraph line breaks. Never invent unreadable text.',
        'Return one item for every supplied region, using exactly its supplied index. Output JSON only: {"lines":[{"index":0,"text":"..."}]}.',
      ].join(' '),
    }) as { lines?: unknown };
    return matchRecognitionResultSet(crops, response.lines, this.tokenizer);
  }

  async detectLines(input: LineDetectorInput): Promise<DetectedLine[]> {
    const response = await this.implementation.requestJson({
      operation: 'detection',
      content: [{ type: 'image_url', image_url: { url: `data:${input.mimeType || 'image/png'};base64,${input.imageBuffer.toString('base64')}` } }],
      prompt: [
        'Find every visible handwritten or printed Tajik Cyrillic text line on this page.',
        'Return one tight axis-aligned box per physical text line, in natural top-to-bottom reading order.',
        'Do not merge several lines into one box. Ignore page borders, grid lines, shadows, and decorations.',
        'Coordinates must be integers normalized to 0..1000 in the exact order [ymin, xmin, ymax, xmax].',
        'If the page contains no text lines, return {"lines":[]}. Return JSON only: {"lines":[{"index":0,"box_2d":[ymin,xmin,ymax,xmax]}]}.',
      ].join(' '),
    }) as { lines?: Array<{ index?: unknown; box_2d?: unknown; box?: unknown; bbox?: unknown }> };
    const lines = Array.isArray(response.lines) ? response.lines : [];
    if (lines.length > 200) throw new HttpError('Recognition request failed.', 'OCR_LINE_LIMIT_EXCEEDED', 422, false);
    return lines.map((line, fallbackIndex) => {
      const rawBox = line.box_2d || line.box || line.bbox;
      if (!Array.isArray(rawBox) || rawBox.length !== 4 || !rawBox.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1000)) {
        throw new HttpError('Recognition request failed.', 'OCR_INVALID_COORDINATES', 502, true);
      }
      const [ymin, xmin, ymax, xmax] = rawBox as number[];
      if (ymin >= ymax || xmin >= xmax) throw new HttpError('Recognition request failed.', 'OCR_DEGENERATE_BOX', 502, true);
      if (((ymax - ymin) / 1000) * ((xmax - xmin) / 1000) > 0.85) throw new HttpError('Recognition request failed.', 'OCR_BOX_TOO_LARGE', 502, true);
      const x = Math.round(((xmin / 1000) * input.width) * 100) / 100;
      const y = Math.round(((ymin / 1000) * input.height) * 100) / 100;
      const width = Math.round((((xmax - xmin) / 1000) * input.width) * 100) / 100;
      const height = Math.round((((ymax - ymin) / 1000) * input.height) * 100) / 100;
      return { readingOrder: typeof line.index === 'number' && Number.isInteger(line.index) ? line.index : fallbackIndex, geometry: { x, y, width, height, polygon: [{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }] } };
    });
  }

  async analyseLayout(input: LayoutAnalysisInput): Promise<unknown> {
    return this.implementation.requestJson({
      operation: 'layout',
      content: [{ type: 'image_url', image_url: { url: `data:${input.mimeType};base64,${input.imageBuffer.toString('base64')}` } }],
      maxOutputTokens: Math.min(1024, Math.max(256, 100 + input.regions.length * 18)),
      prompt: [
        'Analyze document layout only. Do not transcribe, quote, correct, summarize, or return any text from the image.',
        'For each region, decide its separator before it: none continues the same visual line, line starts a new line, paragraph starts a new paragraph.',
        'Set indent from 0 to 6 in four-space steps. Return JSON only: {"lines":[{"index":0,"separatorBefore":"none|line|paragraph","indent":0}]}.',
        'Return exactly one object for every index. The first item must use separatorBefore="none".',
        `Regions: ${JSON.stringify(input.regions)}`,
      ].join(' '),
    });
  }
}
