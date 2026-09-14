import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { getServerConfig } from '@/server/config';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id: assetId } = await params;
    const config = getServerConfig();
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const { data: asset, error: assetError } = await supabase
      .from('assets')
      .select('id, document_id, owner_id, object_key, kind, mime, bytes')
      .eq('id', assetId)
      .eq('owner_id', user.id)
      .single();

    if (assetError || !asset) {
      throw new HttpError('Файл не найден или доступ ограничен.', 'ASSET_NOT_FOUND', 404, false);
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(config.SUPABASE_STORAGE_BUCKET)
      .createSignedUrl(asset.object_key, 3600);

    if (signError || !signed?.signedUrl) {
      throw new HttpError('Не удалось создать ссылку для просмотра.', 'SIGN_URL_FAILED', 503, true);
    }

    return jsonNoStore({
      url: signed.signedUrl,
      kind: asset.kind,
      mime: asset.mime,
      bytes: asset.bytes,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
