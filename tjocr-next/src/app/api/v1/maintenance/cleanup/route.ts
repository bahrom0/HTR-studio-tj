import { timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { createAdminSupabaseClient } from '@/server/supabase/admin';
import { getServerConfig } from '@/server/config';
import { errorResponse, HttpError, jsonNoStore } from '@/server/security/request';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function hasValidCronSecret(request: NextRequest, secret: string) {
  const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const expected = Buffer.from(secret);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: NextRequest) {
  try {
    const config = getServerConfig();
    if (!config.CRON_SECRET) throw new HttpError('Секрет очистки не настроен.', 'CRON_NOT_CONFIGURED', 503, false);
    if (!hasValidCronSecret(request, config.CRON_SECRET)) {
      throw new HttpError('Недостаточно прав.', 'CRON_UNAUTHORIZED', 401, false);
    }

    const admin = createAdminSupabaseClient();
    const now = new Date().toISOString();
    const { data: expiredDocuments, error: documentsError } = await admin
      .from('documents')
      .select('id')
      .not('expires_at', 'is', null)
      .lt('expires_at', now)
      .is('deleted_at', null)
      .limit(100);
    if (documentsError) throw new HttpError('Не удалось найти истёкшие документы.', 'CLEANUP_QUERY_FAILED', 503, true);

    let deleted = 0;
    const failures: string[] = [];
    for (const document of expiredDocuments || []) {
      const { data: assets, error: assetsError } = await admin
        .from('assets')
        .select('object_key')
        .eq('document_id', document.id);
      if (assetsError) {
        failures.push(document.id);
        continue;
      }

      const objectKeys = (assets || []).map((asset) => asset.object_key).filter(Boolean);
      if (objectKeys.length > 0) {
        const { error: storageError } = await admin.storage
          .from(config.SUPABASE_STORAGE_BUCKET)
          .remove(objectKeys);
        if (storageError) {
          failures.push(document.id);
          continue;
        }
      }

      const { error: deleteError } = await admin
        .from('documents')
        .delete()
        .eq('id', document.id);
      if (deleteError) failures.push(document.id);
      else deleted += 1;
    }

    return jsonNoStore({
      scanned: expiredDocuments?.length || 0,
      deleted,
      failed: failures.length,
      failedDocumentIds: failures,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
