import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';

const updateTextSchema = z.object({
  editedText: z.string().max(10_000),
  expectedVersion: z.number().int().min(0),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id: lineResultId } = await params;
    const payload = updateTextSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      throw new HttpError('Некорректные данные правки текста.', 'INVALID_TEXT_EDIT', 400, false);
    }

    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);
    const { data: result, error: resultError } = await supabase
      .from('line_results')
      .select('id, job_id, raw_text')
      .eq('id', lineResultId)
      .single();

    if (resultError || !result) {
      throw new HttpError('Строка распознавания не найдена.', 'LINE_RESULT_NOT_FOUND', 404, false);
    }

    const { data: job, error: jobError } = await supabase
      .from('jobs')
      .select('id, owner_id')
      .eq('id', result.job_id)
      .single();

    if (jobError || !job || job.owner_id !== user.id) {
      throw new HttpError('Доступ к строке ограничен.', 'LINE_RESULT_FORBIDDEN', 403, false);
    }

    const { data: currentEdit, error: editError } = await supabase
      .from('text_edits')
      .select('id, edited_text, version')
      .eq('line_result_id', lineResultId)
      .maybeSingle();

    if (editError) {
      throw new HttpError('Не удалось прочитать сохранённую правку.', 'TEXT_EDIT_LOOKUP_FAILED', 503, true);
    }

    const currentVersion = currentEdit?.version ?? 0;
    if (payload.data.expectedVersion !== currentVersion) {
      return jsonNoStore(
        {
          error: {
            code: 'TEXT_EDIT_VERSION_CONFLICT',
            messageKey: 'Конфликт версии текста. Выберите актуальную версию или сохраните свою правку повторно.',
            retryable: true,
          },
          current: {
            editedText: currentEdit?.edited_text ?? result.raw_text,
            version: currentVersion,
          },
        },
        { status: 409 },
      );
    }

    const nextVersion = currentVersion + 1;
    const now = new Date().toISOString();
    const mutation = currentEdit
      ? supabase
          .from('text_edits')
          .update({ edited_text: payload.data.editedText, version: nextVersion, updated_at: now })
          .eq('id', currentEdit.id)
          .eq('version', currentVersion)
          .select('edited_text, version, updated_at')
          .single()
      : supabase
          .from('text_edits')
          .insert({ line_result_id: lineResultId, edited_text: payload.data.editedText, version: nextVersion, updated_at: now })
          .select('edited_text, version, updated_at')
          .single();

    const { data: savedEdit, error: saveError } = await mutation;
    if (saveError || !savedEdit) {
      throw new HttpError('Не удалось сохранить правку текста.', 'TEXT_EDIT_SAVE_FAILED', 503, true);
    }

    return jsonNoStore({
      edit: {
        editedText: savedEdit.edited_text,
        version: savedEdit.version,
        updatedAt: savedEdit.updated_at,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
