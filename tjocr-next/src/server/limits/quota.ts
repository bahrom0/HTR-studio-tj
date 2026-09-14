import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '@/server/security/request';

export type QuotaSnapshot = {
  plan: 'anonymous' | 'authenticated';
  usedDocuments: number;
  maxDocuments: number;
  usedBytes: number;
  maxBytes: number;
  windowDays: number;
  resetAt: string;
};

type QuotaRpcResponse = {
  allowed?: boolean;
  reason?: 'documents' | 'bytes' | 'unauthorized';
  document?: Record<string, unknown>;
  quota?: QuotaSnapshot;
};

function quotaError(message: string, code: string, status = 503, retryable = true) {
  return new HttpError(message, code, status, retryable);
}

export async function createDocumentWithQuota(
  client: SupabaseClient,
  title: string,
  bytes: number,
) {
  const { data, error } = await client.rpc('create_document_with_quota', {
    p_title: title,
    p_bytes: bytes,
  });

  if (error || !data) {
    throw quotaError('Схема квот ещё не применена.', 'QUOTA_NOT_CONFIGURED');
  }

  const result = data as QuotaRpcResponse;
  if (result.allowed === false) {
    const retryAfter = result.quota?.resetAt
      ? Math.max(1, Math.ceil((new Date(result.quota.resetAt).getTime() - Date.now()) / 1000))
      : 60;
    throw new HttpError(
      result.reason === 'bytes' ? 'Превышен доступный объём загрузок.' : 'Лимит документов на этот период исчерпан.',
      result.reason === 'bytes' ? 'QUOTA_BYTES_EXCEEDED' : 'QUOTA_DOCUMENTS_EXCEEDED',
      429,
      false,
      { 'Retry-After': String(retryAfter) },
    );
  }

  if (!result.document || !result.quota) {
    throw quotaError('Сервер вернул неполный ответ квоты.', 'QUOTA_INVALID_RESPONSE');
  }

  return { document: result.document, quota: result.quota };
}

export async function getDocumentQuota(client: SupabaseClient): Promise<QuotaSnapshot | null> {
  const { data, error } = await client.rpc('get_document_quota');
  if (error || !data || typeof data !== 'object') return null;
  const payload = data as { quota?: QuotaSnapshot };
  return payload.quota || null;
}
