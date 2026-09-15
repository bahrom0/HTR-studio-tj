import { NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { getServerConfig } from '@/server/config';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';
import { validateAndNormalizeImage } from '@/server/images/normalizer';

const patchDocumentSchema = z.object({
  title: z.string().trim().min(1).max(255).optional(),
  rotate: z.union([z.literal(90), z.literal(180), z.literal(270)]).optional(),
  expectedVersion: z.number().int().positive().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: documentId } = await params;
    const config = getServerConfig();
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .single();

    if (docError || !document) {
      throw new HttpError('Документ не найден или был удалён.', 'DOCUMENT_NOT_FOUND', 404, false);
    }

    const { data: page } = await supabase
      .from('pages')
      .select('*')
      .eq('document_id', documentId)
      .maybeSingle();

    let previewUrl: string | null = null;
    let normalizedAsset = null;
    let sourceAsset = null;

    if (page?.normalized_asset_id) {
      const { data: norm } = await supabase
        .from('assets')
        .select('*')
        .eq('id', page.normalized_asset_id)
        .maybeSingle();
      normalizedAsset = norm;
      if (norm?.object_key) {
        const { data: signed } = await supabase.storage
          .from(config.SUPABASE_STORAGE_BUCKET)
          .createSignedUrl(norm.object_key, 3600);
        previewUrl = signed?.signedUrl || null;
      }
    } else if (page?.source_asset_id) {
      const { data: src } = await supabase
        .from('assets')
        .select('*')
        .eq('id', page.source_asset_id)
        .maybeSingle();
      sourceAsset = src;
      if (src?.object_key) {
        const { data: signed } = await supabase.storage
          .from(config.SUPABASE_STORAGE_BUCKET)
          .createSignedUrl(src.object_key, 3600);
        previewUrl = signed?.signedUrl || null;
      }
    }

    return jsonNoStore({
      document: {
        id: document.id,
        ownerId: document.owner_id,
        title: document.title,
        state: document.state,
        expiresAt: document.expires_at,
        bytes: Number(document.bytes || 0),
        version: document.version,
        createdAt: document.created_at,
        updatedAt: document.updated_at,
      },
      page: page
        ? {
            id: page.id,
            documentId: page.document_id,
            sourceAssetId: page.source_asset_id,
            normalizedAssetId: page.normalized_asset_id,
            width: page.width,
            height: page.height,
            imageRevision: page.image_revision,
            createdAt: page.created_at,
          }
        : null,
      previewUrl,
      sourceAsset,
      normalizedAsset,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id: documentId } = await params;
    const config = getServerConfig();
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const body = await request.json().catch(() => ({}));
    const parsed = patchDocumentSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError('Некорректные параметры обновления документа.', 'INVALID_PATCH_INPUT', 400, false);
    }

    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .single();

    if (docError || !document) {
      throw new HttpError('Документ не найден.', 'DOCUMENT_NOT_FOUND', 404, false);
    }

    if (parsed.data.expectedVersion && document.version !== parsed.data.expectedVersion) {
      throw new HttpError('Конфликт версий документа.', 'DOCUMENT_VERSION_CONFLICT', 409, false);
    }

    let nextVersion = document.version + 1;
    let previewUrl: string | null = null;

    // Handle image rotation
    if (parsed.data.rotate) {
      const { data: page } = await supabase
        .from('pages')
        .select('*')
        .eq('document_id', documentId)
        .single();

      if (!page || !page.source_asset_id) {
        throw new HttpError('Страница или исходный файл для поворота не найдены.', 'PAGE_SOURCE_NOT_FOUND', 404, false);
      }

      const { data: sourceAsset } = await supabase
        .from('assets')
        .select('*')
        .eq('id', page.source_asset_id)
        .single();

      if (!sourceAsset?.object_key) {
        throw new HttpError('Исходный файл не найден в хранилище.', 'SOURCE_ASSET_NOT_FOUND', 404, false);
      }

      // Download source file
      const { data: blob, error: downloadError } = await supabase.storage
        .from(config.SUPABASE_STORAGE_BUCKET)
        .download(sourceAsset.object_key);

      if (downloadError || !blob) {
        throw new HttpError('Не удалось загрузить исходное изображение.', 'STORAGE_DOWNLOAD_FAILED', 502, true);
      }

      const rawBuffer = Buffer.from(await blob.arrayBuffer());
      const normalized = await validateAndNormalizeImage(rawBuffer, { rotateDegrees: parsed.data.rotate });

      const newNormalizedKey = `${user.id}/${documentId}/normalized-${crypto.randomUUID()}.png`;
      const { error: uploadError } = await supabase.storage
        .from(config.SUPABASE_STORAGE_BUCKET)
        .upload(newNormalizedKey, normalized.normalizedBuffer, {
          contentType: 'image/png',
          upsert: true,
        });

      if (uploadError) {
        throw new HttpError('Не удалось сохранить повёрнутое изображение.', 'NORMALIZED_UPLOAD_FAILED', 503, true);
      }

      const { data: newNormAsset } = await supabase
        .from('assets')
        .insert({
          document_id: documentId,
          owner_id: user.id,
          object_key: newNormalizedKey,
          kind: 'normalized',
          mime: 'image/png',
          bytes: normalized.normalizedBuffer.length,
          checksum: normalized.normalizedChecksum,
          state: 'committed',
        })
        .select()
        .single();

      await supabase
        .from('pages')
        .update({
          normalized_asset_id: newNormAsset?.id,
          width: normalized.normalizedWidth,
          height: normalized.normalizedHeight,
          image_revision: (page.image_revision || 1) + 1,
        })
        .eq('id', page.id);

      const { data: signed } = await supabase.storage
        .from(config.SUPABASE_STORAGE_BUCKET)
        .createSignedUrl(newNormalizedKey, 3600);
      previewUrl = signed?.signedUrl || null;
    }

    const updates: Record<string, unknown> = {
      version: nextVersion,
      updated_at: new Date().toISOString(),
    };
    if (parsed.data.title) updates.title = parsed.data.title;

    const { data: updatedDoc, error: updateError } = await supabase
      .from('documents')
      .update(updates)
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .select()
      .single();

    if (updateError || !updatedDoc) {
      throw new HttpError('Не удалось обновить документ.', 'DOCUMENT_UPDATE_FAILED', 503, true);
    }

    return jsonNoStore({
      success: true,
      document: {
        id: updatedDoc.id,
        ownerId: updatedDoc.owner_id,
        title: updatedDoc.title,
        state: updatedDoc.state,
        version: updatedDoc.version,
        updatedAt: updatedDoc.updated_at,
      },
      previewUrl,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id: documentId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const { error } = await supabase
      .from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', documentId)
      .eq('owner_id', user.id);

    if (error) {
      throw new HttpError('Не удалось удалить документ.', 'DOCUMENT_DELETE_FAILED', 503, true);
    }

    return jsonNoStore({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
