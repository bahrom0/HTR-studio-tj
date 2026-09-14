import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { getServerConfig } from '@/server/config';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';
import { enforceRateLimit } from '@/server/security/rate-limit';

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

    // A second confirmation request should return the original records instead
    // of creating duplicate assets/pages or turning a successful upload into a
    // 500 response.
    const { data: existingAsset } = await supabase
      .from('assets')
      .select('*')
      .eq('document_id', documentId)
      .eq('object_key', parsed.data.objectKey)
      .maybeSingle();
    if (existingAsset) {
      const { data: existingPage } = await supabase
        .from('pages')
        .select('id')
        .eq('document_id', documentId)
        .eq('source_asset_id', existingAsset.id)
        .maybeSingle();
      return jsonNoStore({
        success: true,
        documentId,
        pageId: existingPage?.id ?? null,
        asset: toAssetDto(existingAsset as unknown as Record<string, unknown>),
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

    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .insert({
        document_id: documentId,
        owner_id: user.id,
        object_key: parsed.data.objectKey,
        kind: 'source',
        mime: parsed.data.mime,
        bytes: actualBytes,
        checksum: fileMeta.id || 'verified',
        state: 'committed',
      })
      .select()
      .single();
    if (assetError || !asset) {
      throw new HttpError('Не удалось сохранить сведения о файле.', 'ASSET_CREATION_FAILED', 503, true);
    }

    const { data: page, error: pageError } = await supabase
      .from('pages')
      .insert({
        document_id: documentId,
        source_asset_id: asset.id,
        width: 0,
        height: 0,
        image_revision: 1,
      })
      .select('id')
      .single();
    if (pageError || !page) {
      await supabase.from('assets').delete().eq('id', asset.id).eq('owner_id', user.id);
      throw new HttpError('Не удалось создать страницу документа.', 'PAGE_CREATION_FAILED', 503, true);
    }

    const { error: documentUpdateError } = await supabase
      .from('documents')
      .update({ state: 'uploaded', bytes: actualBytes })
      .eq('id', documentId)
      .eq('owner_id', user.id);
    if (documentUpdateError) throw new HttpError('Не удалось завершить загрузку.', 'DOCUMENT_UPDATE_FAILED', 503, true);

    return jsonNoStore({
      success: true,
      documentId,
      pageId: page.id,
      assetId: asset.id,
      asset: toAssetDto(asset as unknown as Record<string, unknown>),
      bytes: actualBytes,
      idempotent: false,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
