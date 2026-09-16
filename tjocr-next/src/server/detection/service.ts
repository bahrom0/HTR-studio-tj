import { SupabaseClient } from '@supabase/supabase-js';
import { createAdminSupabaseClient } from '@/server/supabase/admin';
import { getServerConfig } from '@/server/config';
import { JobDto, JobStatus } from '@/domain/types';
import { HttpError } from '@/server/security/request';
import { getOCRPipeline } from '@/ocr';

export class DetectionJobService {
  /**
   * Starts a detection job for a given page.
   * If an active detection job is already running or queued, returns it idempotently.
   */
  static async startDetectionJob(
    pageId: string,
    ownerId: string,
    client?: SupabaseClient,
  ): Promise<{ job: JobDto; alreadyRunning: boolean }> {
    const db = client || createAdminSupabaseClient();

    // 1. Verify page ownership
    const { data: page, error: pageError } = await db
      .from('pages')
      .select('id, document_id, width, height, image_revision, normalized_asset_id, source_asset_id')
      .eq('id', pageId)
      .single();

    if (pageError || !page) {
      throw new HttpError('Страница не найдена.', 'PAGE_NOT_FOUND', 404, false);
    }

    const { data: document, error: docError } = await db
      .from('documents')
      .select('id, owner_id, state')
      .eq('id', page.document_id)
      .single();

    if (docError || !document || document.owner_id !== ownerId) {
      throw new HttpError('Доступ к документу ограничен.', 'DOCUMENT_FORBIDDEN', 403, false);
    }

    // 2. Check for active detection job (idempotency safeguard)
    const { data: activeJob } = await db
      .from('jobs')
      .select('*')
      .eq('document_id', page.document_id)
      .eq('kind', 'detection')
      .in('status', ['queued', 'running'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeJob) {
      return {
        alreadyRunning: true,
        job: {
          id: activeJob.id,
          documentId: activeJob.document_id,
          ownerId: activeJob.owner_id,
          kind: activeJob.kind,
          status: activeJob.status as JobStatus,
          completedCount: activeJob.completed_count,
          failedCount: activeJob.failed_count,
          totalCount: activeJob.total_count,
          workflowId: activeJob.workflow_id,
          errorCode: activeJob.error_code,
          createdAt: activeJob.created_at,
          updatedAt: activeJob.updated_at,
        },
      };
    }

    // 3. Create new job record
    const { data: newJob, error: jobError } = await db
      .from('jobs')
      .insert({
        document_id: page.document_id,
        owner_id: ownerId,
        kind: 'detection',
        status: 'queued',
        total_count: 1,
        completed_count: 0,
        failed_count: 0,
      })
      .select()
      .single();

    if (jobError || !newJob) {
      throw new HttpError('Не удалось создать задачу детекции строк.', 'JOB_CREATION_FAILED', 503, true);
    }

    // 4. Create outbox record
    await db.from('job_outbox').insert({
      job_id: newJob.id,
      dispatch_state: 'pending',
      payload: { pageId, documentId: page.document_id },
    });

    // 5. Update document status
    await db
      .from('documents')
      .update({ state: 'detecting', updated_at: new Date().toISOString() })
      .eq('id', page.document_id);

    const jobDto: JobDto = {
      id: newJob.id,
      documentId: newJob.document_id,
      ownerId: newJob.owner_id,
      kind: newJob.kind,
      status: newJob.status as JobStatus,
      completedCount: newJob.completed_count,
      failedCount: newJob.failed_count,
      totalCount: newJob.total_count,
      workflowId: newJob.workflow_id,
      errorCode: newJob.error_code,
      createdAt: newJob.created_at,
      updatedAt: newJob.updated_at,
    };

    return { job: jobDto, alreadyRunning: false };
  }

  /**
   * Executes the line detection step durably.
   */
  static async executeDetection(
    jobId: string,
    pageId: string,
    ownerId: string,
    client?: SupabaseClient,
  ): Promise<JobDto> {
    const db = client || createAdminSupabaseClient();
    const config = getServerConfig();

    // Mark job running
    await db
      .from('jobs')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', jobId);

    try {
      const { data: page, error: pageError } = await db
        .from('pages')
        .select('id, document_id, width, height, image_revision, normalized_asset_id, source_asset_id')
        .eq('id', pageId)
        .single();

      if (pageError || !page) {
        throw new HttpError('Страница не найдена.', 'PAGE_NOT_FOUND', 404, false);
      }

      const assetId = page.normalized_asset_id || page.source_asset_id;
      if (!assetId) {
        throw new HttpError('У страницы отсутствует файл изображения.', 'PAGE_ASSET_NOT_FOUND', 404, false);
      }

      const { data: asset, error: assetError } = await db
        .from('assets')
        .select('id, object_key, mime')
        .eq('id', assetId)
        .single();

      if (assetError || !asset?.object_key) {
        throw new HttpError('Файл страницы не найден в базе данных.', 'ASSET_NOT_FOUND', 404, false);
      }

      // Download image from storage
      const { data: blob, error: downloadError } = await db.storage
        .from(config.SUPABASE_STORAGE_BUCKET)
        .download(asset.object_key);

      if (downloadError || !blob) {
        throw new HttpError('Не удалось скачать изображение для детекции.', 'STORAGE_DOWNLOAD_FAILED', 502, true);
      }

      const imageBuffer = Buffer.from(await blob.arrayBuffer());
      const lines = await getOCRPipeline().detectLines({
        imageBuffer,
        mimeType: asset.mime,
        width: page.width || 2048,
        height: page.height || 2048,
      });

      // Get next revision number
      const { data: existingRevisions } = await db
        .from('region_revisions')
        .select('revision_number')
        .eq('page_id', pageId)
        .order('revision_number', { ascending: false })
        .limit(1);

      const nextRevNum = (existingRevisions?.[0]?.revision_number || 0) + 1;

      // Insert new revision
      const { data: revision, error: revError } = await db
        .from('region_revisions')
        .insert({
          page_id: pageId,
          revision_number: nextRevNum,
          image_revision: page.image_revision,
          confirmed_at: null,
        })
        .select('id')
        .single();

      if (revError || !revision) {
        throw new HttpError('Не удалось сохранить ревизию разметки.', 'REVISION_SAVE_FAILED', 503, true);
      }

      // Insert regions if lines were detected
      if (lines.length > 0) {
        const regionRows = lines.map((line) => ({
          revision_id: revision.id,
          reading_order: line.readingOrder,
          geometry: line.geometry,
          excluded: false,
        }));

        const { error: insertRegionsError } = await db
          .from('regions')
          .insert(regionRows);

        if (insertRegionsError) {
          throw new HttpError('Не удалось сохранить найденные строки.', 'REGIONS_SAVE_FAILED', 503, true);
        }
      }

      // Update job to succeeded
      const { data: updatedJob } = await db
        .from('jobs')
        .update({
          status: 'succeeded',
          revision_id: revision.id,
          completed_count: lines.length,
          total_count: lines.length,
          error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .select()
        .single();

      // Mark outbox dispatched
      await db
        .from('job_outbox')
        .update({ dispatch_state: 'dispatched' })
        .eq('job_id', jobId);

      // Update document state to lines_ready
      await db
        .from('documents')
        .update({
          state: 'lines_ready',
          updated_at: new Date().toISOString(),
        })
        .eq('id', page.document_id);

      return {
        id: updatedJob.id,
        documentId: updatedJob.document_id,
        ownerId: updatedJob.owner_id,
        kind: updatedJob.kind,
        status: updatedJob.status as JobStatus,
        completedCount: updatedJob.completed_count,
        failedCount: updatedJob.failed_count,
        totalCount: updatedJob.total_count,
        workflowId: updatedJob.workflow_id,
        errorCode: updatedJob.error_code,
        createdAt: updatedJob.created_at,
        updatedAt: updatedJob.updated_at,
      };
    } catch (error) {
      const errorCode = error instanceof HttpError ? error.code : 'DETECTION_FAILED';

      await db
        .from('jobs')
        .update({
          status: 'failed',
          error_code: errorCode,
          failed_count: 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      // Revert document to uploaded state so user can retry or manually annotate
      const { data: currentJob } = await db.from('jobs').select('document_id').eq('id', jobId).single();
      if (currentJob?.document_id) {
        await db
          .from('documents')
          .update({ state: 'uploaded', updated_at: new Date().toISOString() })
          .eq('id', currentJob.document_id);
      }

      throw error;
    }
  }
}
