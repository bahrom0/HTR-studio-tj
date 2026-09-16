import { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { ExportLayoutItem, normalizeExportLayout } from '@/lib/export-layout';
import { getServerConfig } from '@/server/config';
import { RecognitionJobService } from '@/server/recognition/service';
import { HttpError } from '@/server/security/request';
import { getOCRPipeline } from '@/ocr';

type LayoutSource = { index: number; x: number; y: number; width: number; height: number };

/**
 * The analyser receives a compressed document image plus geometry only. OCR
 * text and user edits deliberately never leave the application in this call.
 */
export class ExportLayoutService {
  static async analyse(documentId: string, ownerId: string, db: SupabaseClient): Promise<ExportLayoutItem[]> {
    const config = getServerConfig();
    getOCRPipeline().assertConfiguration();
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
    const analysis = await getOCRPipeline().analyseLayout({
      imageBuffer: pageImage,
      mimeType: 'image/jpeg',
      regions: sources,
    }) as { lines?: unknown };
    const layout = normalizeExportLayout(analysis.lines, sources.map((source) => source.index));
    if (!layout || layout[0]?.separatorBefore !== 'none') throw new HttpError('Сервис подготовки экспорта вернул неполный план.', 'EXPORT_LAYOUT_INVALID_RESULT', 502, true);
    return layout;
  }
}
