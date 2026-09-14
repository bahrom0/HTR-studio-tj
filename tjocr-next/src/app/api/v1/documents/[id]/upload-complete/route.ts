import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { getServerConfig } from '@/server/config';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';
import { enforceRateLimit } from '@/server/security/rate-limit';
import { validateAndNormalizeImage } from '@/server/images/normalizer';

const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

const completeUploadSchema = z.object({
  objectKey: z.string().min(1).max(512),
  mime: z.string().trim().toLowerCase().default('image/jpeg'),
  bytes: z.coerce.number().int().positive(),
});

function isSafeObjectKey(objectKey: string, userId: string, documentId: string) {
  const prefix = `${userId}/${documentId}/`;
  return objectKey.startsWith(prefix)
    && objectKey.split('/').length === 3
    && !objectKey.includes('..')
    && /^[a-zA-Z0-9-]+\.bin$/.test(objectKey.split('/').at(-1) || '');
}

function toAssetDto(asset: Record<string, unknown>) {
  return {
    id: asset.id,
    documentId: asset.document_id,
    ownerId: asset.owner_id,
    objectKey: asset.object_key,
    kind: asset.kind,
    mime: asset.mime,
    bytes: Number(asset.bytes || 0),
    checksum: asset.checksum,
    createdAt: asset.created_at,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const config = getServerConfig();
    await enforceRateLimit(request, 'documents:complete', config.DOCUMENT_RATE_LIMIT_PER_MINUTE);

    const { id: documentId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);
    const parsed = completeUploadSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw new HttpError('Параметры файла заполнены неверно.', 'INVALID_UPLOAD_INPUT', 400, false);
    if (parsed.data.bytes > config.MAX_UPLOAD_BYTES) {
      throw new HttpError('Файл превышает допустимый размер.', 'FILE_TOO_LARGE', 413, false);
    }
    if (!allowedMimeTypes.has(parsed.data.mime)) {
      throw new HttpError('Поддерживаются только JPG, PNG и WEBP.', 'UNSUPPORTED_FILE_TYPE', 415, false);
    }
    if (!isSafeObjectKey(parsed.data.objectKey, user.id, documentId)) {
      throw new HttpError('Недопустимый путь файла.', 'FORBIDDEN_OBJECT_PATH', 403, false);
    }

    const { data: document, error: documentError } = await supabase
      .from('documents')
      .select('id, state, bytes, expires_at')
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .single();
    if (documentError || !document) throw new HttpError('Документ не найден.', 'DOCUMENT_NOT_FOUND', 404, false);

    // Check if source asset already exists (idempotent retry)
    const { data: existingAsset } = await supabase
      .from('assets')
      .select('*')
      .eq('document_id', documentId)
      .eq('object_key', parsed.data.objectKey)
      .maybeSingle();

    if (existingAsset) {
      const { data: existingPage } = await supabase
        .from('pages')
        .select('id, width, height, normalized_asset_id')
        .eq('document_id', documentId)
        .eq('source_asset_id', existingAsset.id)
        .maybeSingle();

      const { data: existingNormalized } = existingPage?.normalized_asset_id
        ? await supabase.from('assets').select('*').eq('id', existingPage.normalized_asset_id).maybeSingle()
        : { data: null };

      return jsonNoStore({
        success: true,
        documentId,
        pageId: existingPage?.id ?? null,
        asset: toAssetDto(existingAsset as unknown as Record<string, unknown>),
        normalizedAsset: existingNormalized ? toAssetDto(existingNormalized as unknown as Record<string, unknown>) : null,
        width: existingPage?.width ?? 0,
        height: existingPage?.height ?? 0,
        bytes: Number(existingAsset.bytes || 0),
        idempotent: true,
      });
    }

    const folder = parsed.data.objectKey.split('/').slice(0, -1).join('/');
    const filename = parsed.data.objectKey.split('/').at(-1)!;
    const { data: fileList, error: listError } = await supabase.storage
      .from(config.SUPABASE_STORAGE_BUCKET)
      .list(folder, { search: filename, limit: 10 });
    const fileMeta = fileList?.find((file) => file.name === filename);
    if (listError || !fileMeta) {
      throw new HttpError('Файл ещё не появился в хранилище.', 'STORAGE_OBJECT_NOT_FOUND', 404, true);
    }

    const actualBytes = Number(fileMeta.metadata?.size || parsed.data.bytes);
    if (!Number.isSafeInteger(actualBytes) || actualBytes <= 0 || actualBytes > config.MAX_UPLOAD_BYTES) {
      await supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).remove([parsed.data.objectKey]);
      throw new HttpError('Размер файла не прошёл проверку.', 'INVALID_UPLOAD_SIZE', 400, false);
    }
    if (actualBytes > Number(document.bytes || 0)) {
      await supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).remove([parsed.data.objectKey]);
      throw new HttpError('Размер файла изменился во время загрузки.', 'UPLOAD_SIZE_MISMATCH', 400, false);
    }

    // Download uploaded bytes to validate and normalize
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from(config.SUPABASE_STORAGE_BUCKET)
      .download(parsed.data.objectKey);

    if (downloadError || !fileBlob) {
      throw new HttpError('Не удалось прочитать загруженный файл из хранилища.', 'STORAGE_DOWNLOAD_FAILED', 502, true);
    }

    const rawBuffer = Buffer.from(await fileBlob.arrayBuffer());

    // Validate format, magic bytes, dimensions, and normalize
    let normalized;
    try {
      normalized = await validateAndNormalizeImage(rawBuffer);
    } catch (normError) {
      // Clean up invalid object from storage
      await supabase.storage.from(config.SUPABASE_STORAGE_BUCKET).remove([parsed.data.objectKey]);
      throw normError;
    }

    // Upload immutable normalized PNG asset
    const normalizedKey = `${user.id}/${documentId}/normalized-${crypto.randomUUID()}.png`;
    const { error: normalizedUploadError } = await supabase.storage
      .from(config.SUPABASE_STORAGE_BUCKET)
      .upload(normalizedKey, normalized.normalizedBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (normalizedUploadError) {
      throw new HttpError('Не удалось сохранить нормализованное изображение.', 'NORMALIZED_UPLOAD_FAILED', 503, true);
    }

    // Insert source asset
    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .insert({
        document_id: documentId,
        owner_id: user.id,
        object_key: parsed.data.objectKey,
        kind: 'source',
        mime: parsed.data.mime,
        bytes: actualBytes,
        checksum: normalized.sourceChecksum,
        state: 'committed',
      })
      .select()
      .single();

    if (assetError || !asset) {
      throw new HttpError('Не удалось сохранить сведения об исходном файле.', 'ASSET_CREATION_FAILED', 503, true);
    }

    // Insert normalized asset
    const { data: normalizedAsset, error: normAssetError } = await supabase
      .from('assets')
      .insert({
        document_id: documentId,
        owner_id: user.id,
        object_key: normalizedKey,
        kind: 'normalized',
        mime: 'image/png',
        bytes: normalized.normalizedBuffer.length,
        checksum: normalized.normalizedChecksum,
        state: 'committed',
      })
      .select()
      .single();

    if (normAssetError || !normalizedAsset) {
      throw new HttpError('Не удалось сохранить сведения о нормализованном файле.', 'NORMALIZED_ASSET_FAILED', 503, true);
    }

    // Create Page record linking source and normalized asset
    const { data: page, error: pageError } = await supabase
      .from('pages')
      .insert({
        document_id: documentId,
        source_asset_id: asset.id,
        normalized_asset_id: normalizedAsset.id,
        width: normalized.normalizedWidth,
        height: normalized.normalizedHeight,
        image_revision: 1,
      })
      .select('id')
      .single();

    if (pageError || !page) {
      await supabase.from('assets').delete().in('id', [asset.id, normalizedAsset.id]).eq('owner_id', user.id);
      throw new HttpError('Не удалось создать страницу документа.', 'PAGE_CREATION_FAILED', 503, true);
    }

    // Update Document state to uploaded
    const { error: documentUpdateError } = await supabase
      .from('documents')
      .update({ state: 'uploaded', bytes: actualBytes })
      .eq('id', documentId)
      .eq('owner_id', user.id);

    if (documentUpdateError) {
      throw new HttpError('Не удалось завершить загрузку.', 'DOCUMENT_UPDATE_FAILED', 503, true);
    }

    return jsonNoStore({
      success: true,
      documentId,
      pageId: page.id,
      assetId: asset.id,
      normalizedAssetId: normalizedAsset.id,
      asset: toAssetDto(asset as unknown as Record<string, unknown>),
      normalizedAsset: toAssetDto(normalizedAsset as unknown as Record<string, unknown>),
      width: normalized.normalizedWidth,
      height: normalized.normalizedHeight,
      bytes: actualBytes,
      idempotent: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

