import { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { ExportLayoutItem, normalizeExportLayout } from '@/lib/export-layout';
import { getServerConfig } from '@/server/config';
import { RecognitionJobService } from '@/server/recognition/service';
import { HttpError } from '@/server/security/request';

type LayoutSource = { index: number; x: number; y: number; width: number; height: number };

function cleanJson(content: string) {
  return content.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '').trim();
}

/**
 * The analyser receives a compressed document image plus geometry only. OCR
 * text and user edits deliberately never leave the application in this call.
 */
export class ExportLayoutService {
  static async analyse(documentId: string, ownerId: string, db: SupabaseClient): Promise<ExportLayoutItem[]> {
    const config = getServerConfig();
    const modelId = config.RECOGNIZER_MODEL_ID || config.OCR_MODEL_ID;
    const baseUrl = config.OCR_API_BASE_URL;
    if (!config.OCR_API_KEY || !modelId || !baseUrl) {
      throw new HttpError('Сервис подготовки экспорта не настроен.', 'EXPORT_LAYOUT_CONFIGURATION_MISSING', 503, false);
    }
    const results = await RecognitionJobService.getLineResults(documentId, ownerId, db);
    if (results.length === 0) {
      throw new HttpError('Для экспорта пока нет строк.', 'EXPORT_LAYOUT_NO_RESULTS', 409, false);
    }
    const sources: LayoutSource[] = results.map((result, index) => {
      const geometry = result.geometry;
      if (!geometry) throw new HttpError('Не найдены координаты строк для подготовки экспорта.', 'EXPORT_LAYOUT_GEOMETRY_MISSING', 409, false);
      return { index, x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
    });
    const { data: page, error: pageError } = await db
      .from('pages').select('normalized_asset_id, source_asset_id').eq('document_id', documentId).maybeSingle();
    if (pageError || !page) throw new HttpError('Страница документа не найдена.', 'EXPORT_LAYOUT_PAGE_NOT_FOUND', 404, false);
    const assetId = page.normalized_asset_id || page.source_asset_id;
    if (!assetId) throw new HttpError('Изображение документа не найдено.', 'EXPORT_LAYOUT_ASSET_NOT_FOUND', 404, false);
    const { data: asset, error: assetError } = await db
      .from('assets').select('object_key').eq('id', assetId).eq('owner_id', ownerId).maybeSingle();
    if (assetError || !asset?.object_key) throw new HttpError('Изображение документа недоступно.', 'EXPORT_LAYOUT_ASSET_FORBIDDEN', 404, false);
    const { data: sourceImage, error: imageError } = await db.storage
      .from(config.SUPABASE_STORAGE_BUCKET).download(asset.object_key);
    if (imageError || !sourceImage) throw new HttpError('Не удалось прочитать изображение документа.', 'EXPORT_LAYOUT_IMAGE_DOWNLOAD_FAILED', 502, true);

    const pageImage = await sharp(Buffer.from(await sourceImage.arrayBuffer()))
      .rotate().resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 76, mozjpeg: true }).toBuffer();
    const prompt = [
      'Analyze document layout only. Do not transcribe, quote, correct, summarize, or return any text from the image.',
      'For each region, decide its separator before it: none continues the same visual line, line starts a new line, paragraph starts a new paragraph.',
      'Set indent from 0 to 6 in four-space steps. Return JSON only: {"lines":[{"index":0,"separatorBefore":"none|line|paragraph","indent":0}]}.',
      'Return exactly one object for every index. The first item must use separatorBefore="none".',
      `Regions: ${JSON.stringify(sources)}`,
    ].join(' ');
    const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(config.OCR_REQUEST_TIMEOUT_MS, 30_000));
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${config.OCR_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': config.NEXT_PUBLIC_APP_URL, 'X-Title': 'Tajik HTR Studio' },
        body: JSON.stringify({
          model: modelId, temperature: 0, max_tokens: Math.min(1024, Math.max(256, 100 + sources.length * 18)), reasoning: { effort: 'low' },
          ...(new URL(baseUrl).hostname.endsWith('openrouter.ai') ? { provider: {
            order: [config.OPENROUTER_OCR_PROVIDER], only: [config.OPENROUTER_OCR_PROVIDER], allow_fallbacks: false, sort: { by: 'latency' },
            preferred_max_latency: { p50: config.OPENROUTER_PREFERRED_MAX_LATENCY_SECONDS }, preferred_min_throughput: { p50: config.OPENROUTER_PREFERRED_MIN_THROUGHPUT },
          } } : {}),
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${pageImage.toString('base64')}` } },
          ] }],
        }),
      });
    } catch {
      if (controller.signal.aborted) throw new HttpError('Подготовка структуры документа заняла слишком много времени.', 'EXPORT_LAYOUT_TIMEOUT', 504, true);
      throw new HttpError('Не удалось связаться с сервисом подготовки экспорта.', 'EXPORT_LAYOUT_NETWORK_ERROR', 502, true);
    } finally { clearTimeout(timeout); }
    if (!response.ok) throw new HttpError('Сервис подготовки экспорта временно недоступен.', 'EXPORT_LAYOUT_UPSTREAM_ERROR', response.status >= 500 ? 502 : 400, response.status >= 500);
    const rawData = await response.json().catch(() => null);
    const content = rawData?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new HttpError('Сервис подготовки экспорта вернул пустой ответ.', 'EXPORT_LAYOUT_EMPTY_RESPONSE', 502, true);
    let parsed: { lines?: unknown };
    try { parsed = JSON.parse(cleanJson(content)); } catch { throw new HttpError('Не удалось разобрать план отступов.', 'EXPORT_LAYOUT_INVALID_JSON', 502, true); }
    const layout = normalizeExportLayout(parsed.lines, sources.map((source) => source.index));
    if (!layout || layout[0]?.separatorBefore !== 'none') throw new HttpError('Сервис подготовки экспорта вернул неполный план.', 'EXPORT_LAYOUT_INVALID_RESULT', 502, true);
    const usage = rawData?.usage || {};
    console.info('[export:layout]', {
      model: modelId, regions: sources.length, responseMs: Math.round(performance.now() - startedAt),
      generationId: response.headers.get('x-generation-id') || rawData?.id || null,
      provider: rawData?.provider || response.headers.get('x-openrouter-provider') || null,
      promptTokens: usage.prompt_tokens ?? null, completionTokens: usage.completion_tokens ?? null,
    });
    return layout;
  }
}
