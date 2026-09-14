import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { getServerConfig } from '@/server/config';
import { createDocumentWithQuota, getDocumentQuota } from '@/server/limits/quota';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';
import { enforceRateLimit } from '@/server/security/rate-limit';

const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(200).default('Новый документ'),
  bytes: z.coerce.number().int().positive(),
});

function toDocumentDto(document: Record<string, unknown>) {
  return {
    id: document.id,
    ownerId: document.owner_id,
    title: document.title,
    state: document.state,
    expiresAt: document.expires_at ?? null,
    bytes: Number(document.bytes || 0),
    version: document.version,
    createdAt: document.created_at,
    updatedAt: document.updated_at,
  };
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const config = getServerConfig();
    await enforceRateLimit(request, 'documents:create', config.DOCUMENT_RATE_LIMIT_PER_MINUTE);

    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const body = await request.json().catch(() => ({}));
    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError('Проверьте название и размер файла.', 'INVALID_DOCUMENT_INPUT', 400, false);
    }
    if (parsed.data.bytes > config.MAX_UPLOAD_BYTES) {
      throw new HttpError('Файл превышает допустимый размер.', 'FILE_TOO_LARGE', 413, false);
    }

    // The RPC checks the account plan and inserts the draft in one transaction.
    const { document, quota } = await createDocumentWithQuota(
      supabase,
      parsed.data.title,
      parsed.data.bytes,
    );
    const documentId = String(document.id);
    const objectKey = `${user.id}/${documentId}/${randomUUID()}.bin`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(config.SUPABASE_STORAGE_BUCKET)
      .createSignedUploadUrl(objectKey);

    if (uploadError || !uploadData?.signedUrl) {
      await supabase.from('documents').delete().eq('id', documentId).eq('owner_id', user.id);
      throw new HttpError('Не удалось подготовить загрузку.', 'STORAGE_RESERVATION_FAILED', 503, true);
    }

    return jsonNoStore({
      document: toDocumentDto(document),
      uploadUrl: uploadData.signedUrl,
      objectKey,
      quota,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);
    const { data: documents, error } = await supabase
      .from('documents')
      .select('id, owner_id, title, state, expires_at, bytes, version, created_at, updated_at')
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (error) throw new HttpError('Не удалось загрузить документы.', 'DOCUMENTS_FETCH_FAILED', 503, true);

    return jsonNoStore({
      documents: (documents || []).map((document) => toDocumentDto(document as unknown as Record<string, unknown>)),
      quota: await getDocumentQuota(supabase),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
