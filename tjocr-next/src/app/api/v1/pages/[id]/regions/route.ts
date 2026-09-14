import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { assertSameOrigin, errorResponse, HttpError, jsonNoStore } from '@/server/security/request';
import { RegionDto, RegionRevisionDto } from '@/domain/types';

const putRegionsSchema = z.object({
  expectedRevision: z.number().int().positive().optional(),
  regions: z.array(
    z.object({
      readingOrder: z.number().int().min(0),
      geometry: z.object({
        x: z.number().min(0),
        y: z.number().min(0),
        width: z.number().positive(),
        height: z.number().positive(),
        polygon: z.array(z.object({ x: z.number(), y: z.number() })).optional(),
      }),
      excluded: z.boolean().default(false),
    }),
  ),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id: pageId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    // Verify page ownership through document
    const { data: page, error: pageError } = await supabase
      .from('pages')
      .select('id, document_id, width, height, image_revision')
      .eq('id', pageId)
      .single();

    if (pageError || !page) {
      throw new HttpError('Страница не найдена.', 'PAGE_NOT_FOUND', 404, false);
    }

    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, owner_id')
      .eq('id', page.document_id)
      .single();

    if (docError || !document || document.owner_id !== user.id) {
      throw new HttpError('Доступ к странице ограничен.', 'PAGE_FORBIDDEN', 403, false);
    }

    // Get latest revision for this page
    const { data: revision } = await supabase
      .from('region_revisions')
      .select('*')
      .eq('page_id', pageId)
      .order('revision_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!revision) {
      return jsonNoStore({ revision: null, regions: [] });
    }

    // Fetch regions for this revision
    const { data: regions, error: regionsError } = await supabase
      .from('regions')
      .select('*')
      .eq('revision_id', revision.id)
      .order('reading_order', { ascending: true });

    if (regionsError) {
      throw new HttpError('Не удалось прочитать строки разметки.', 'REGIONS_FETCH_FAILED', 503, true);
    }

    const regionDtos: RegionDto[] = (regions || []).map((r) => ({
      id: r.id,
      revisionId: r.revision_id,
      readingOrder: r.reading_order,
      geometry: r.geometry,
      excluded: Boolean(r.excluded),
      createdAt: r.created_at,
    }));

    const revisionDto: RegionRevisionDto = {
      id: revision.id,
      pageId: revision.page_id,
      revisionNumber: revision.revision_number,
      imageRevision: revision.image_revision,
      confirmedAt: revision.confirmed_at,
      createdAt: revision.created_at,
      regions: regionDtos,
    };

    return jsonNoStore({
      revision: revisionDto,
      regions: regionDtos,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id: pageId } = await params;
    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);

    const body = await request.json().catch(() => ({}));
    const parsed = putRegionsSchema.safeParse(body);
    if (!parsed.success) {
      throw new HttpError('Некорректный формат разметки строк.', 'INVALID_REGIONS_INPUT', 400, false);
    }

    // Verify page ownership
    const { data: page, error: pageError } = await supabase
      .from('pages')
      .select('id, document_id, image_revision')
      .eq('id', pageId)
      .single();

    if (pageError || !page) {
      throw new HttpError('Страница не найдена.', 'PAGE_NOT_FOUND', 404, false);
    }

    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('id, owner_id')
      .eq('id', page.document_id)
      .single();

    if (docError || !document || document.owner_id !== user.id) {
      throw new HttpError('Доступ к странице ограничен.', 'PAGE_FORBIDDEN', 403, false);
    }

    // Check latest revision for concurrency conflict
    const { data: latestRev } = await supabase
      .from('region_revisions')
      .select('revision_number')
      .eq('page_id', pageId)
      .order('revision_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const currentRevNum = latestRev?.revision_number || 0;
    if (parsed.data.expectedRevision && parsed.data.expectedRevision !== currentRevNum) {
      throw new HttpError('Конфликт версий разметки.', 'REVISION_CONFLICT', 409, false);
    }

    const nextRevNum = currentRevNum + 1;

    // Create new revision
    const { data: newRevision, error: revError } = await supabase
      .from('region_revisions')
      .insert({
        page_id: pageId,
        revision_number: nextRevNum,
        image_revision: page.image_revision,
        confirmed_at: null,
      })
      .select()
      .single();

    if (revError || !newRevision) {
      throw new HttpError('Не удалось создать новую ревизию разметки.', 'REVISION_CREATE_FAILED', 503, true);
    }

    // Insert new regions
    if (parsed.data.regions.length > 0) {
      const regionRows = parsed.data.regions.map((r) => ({
        revision_id: newRevision.id,
        reading_order: r.readingOrder,
        geometry: r.geometry,
        excluded: r.excluded,
      }));

      const { error: regError } = await supabase.from('regions').insert(regionRows);
      if (regError) {
        throw new HttpError('Не удалось сохранить строки новой ревизии.', 'REGIONS_INSERT_FAILED', 503, true);
      }
    }

    // Fetch saved regions
    const { data: savedRegions } = await supabase
      .from('regions')
      .select('*')
      .eq('revision_id', newRevision.id)
      .order('reading_order', { ascending: true });

    return jsonNoStore({
      success: true,
      revisionNumber: nextRevNum,
      revisionId: newRevision.id,
      regions: savedRegions || [],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
