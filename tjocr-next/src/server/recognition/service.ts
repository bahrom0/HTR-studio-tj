import { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { createAdminSupabaseClient } from '@/server/supabase/admin';
import { getServerConfig } from '@/server/config';
import { JobDto, JobStatus, LineResultDto } from '@/domain/types';
import { HttpError } from '@/server/security/request';
import { RemoteTextRecognizer, CropInput, RecognizedLine } from './recognizer';

export class RecognitionJobService {
  /**
   * Starts a recognition job for a given page and revision.
   * If an active recognition job is already running or queued, returns it idempotently.
   */
  static async startRecognitionJob(
    pageId: string,
    ownerId: string,
    revisionId?: string,
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

    // 2. Resolve the target revision
    let targetRevId = revisionId;
    if (!targetRevId) {
      const { data: latestRev } = await db
        .from('region_revisions')
        .select('id')
        .eq('page_id', pageId)
        .order('revision_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      targetRevId = latestRev?.id;
    }

    if (!targetRevId) {
      throw new HttpError(
        'Не найдена разметка строк для распознавания. Сначала разметьте строки.',
        'REVISION_NOT_FOUND',
        400,
        false,
      );
    }

    // Confirm the revision timestamp
    await db
      .from('region_revisions')
      .update({ confirmed_at: new Date().toISOString() })
      .eq('id', targetRevId);

    // 3. Fetch active regions for this revision
    const { data: regions, error: regionsError } = await db
      .from('regions')
      .select('id, reading_order, geometry, excluded')
      .eq('revision_id', targetRevId)
      .eq('excluded', false)
      .order('reading_order', { ascending: true });

    if (regionsError || !regions || regions.length === 0) {
      throw new HttpError(
        'Нет активных строк для распознавания.',
        'NO_ACTIVE_REGIONS',
        400,
        false,
      );
    }

    // 4. Check for active recognition job (idempotency safeguard)
    const { data: activeJob } = await db
      .from('jobs')
      .select('*')
      .eq('document_id', page.document_id)
      .eq('kind', 'recognition')
      .eq('revision_id', targetRevId)
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

    // 5. Create new job record
    const { data: newJob, error: jobError } = await db
      .from('jobs')
      .insert({
        document_id: page.document_id,
        owner_id: ownerId,
        kind: 'recognition',
        revision_id: targetRevId,
        status: 'queued',
        total_count: regions.length,
        completed_count: 0,
        failed_count: 0,
      })
      .select()
      .single();

    if (jobError || !newJob) {
      throw new HttpError(
        'Не удалось создать задачу распознавания.',
        'JOB_CREATION_FAILED',
        503,
        true,
      );
    }

    // 6. Create outbox record
    await db.from('job_outbox').insert({
      job_id: newJob.id,
      dispatch_state: 'pending',
      payload: {
        pageId,
        documentId: page.document_id,
        revisionId: targetRevId,
        lineCount: regions.length,
      },
    });

    // 7. Update document state
    await db
      .from('documents')
      .update({ state: 'recognizing', updated_at: new Date().toISOString() })
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
   * Executes recognition for all regions in the job durably.
   */
  static async executeRecognition(
    jobId: string,
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
      // 1. Fetch job with revision and page
      const { data: job, error: jobError } = await db
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (jobError || !job) {
        throw new HttpError('Задача не найдена.', 'JOB_NOT_FOUND', 404, false);
      }

      const { data: page, error: pageError } = await db
        .from('pages')
        .select('id, document_id, width, height, normalized_asset_id, source_asset_id')
        .eq('document_id', job.document_id)
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
        throw new HttpError('Файл страницы не найден в хранилище.', 'ASSET_NOT_FOUND', 404, false);
      }

      // Download page image
      const { data: blob, error: downloadError } = await db.storage
        .from(config.SUPABASE_STORAGE_BUCKET)
        .download(asset.object_key);

      if (downloadError || !blob) {
        throw new HttpError('Не удалось скачать изображение для нарезки строк.', 'STORAGE_DOWNLOAD_FAILED', 502, true);
      }

      const pageImageBuffer = Buffer.from(await blob.arrayBuffer());
      const imageMeta = await sharp(pageImageBuffer).metadata();
      const imgWidth = imageMeta.width || page.width || 2048;
      const imgHeight = imageMeta.height || page.height || 2048;

      // 2. Fetch regions for this job's revision
      const { data: regions, error: regionsError } = await db
        .from('regions')
        .select('id, reading_order, geometry, excluded')
        .eq('revision_id', job.revision_id)
        .eq('excluded', false)
        .order('reading_order', { ascending: true });

      if (regionsError || !regions || regions.length === 0) {
        throw new HttpError('Не найдены строки для распознавания.', 'NO_REGIONS_FOUND', 400, false);
      }

      // 3. Instantiate Recognizer
      const recognizerModelId = config.RECOGNIZER_MODEL_ID || config.OCR_MODEL_ID || '';
      const recognizer = new RemoteTextRecognizer(
        config.OCR_API_BASE_URL || 'https://openrouter.ai/api/v1',
        config.OCR_API_KEY || '',
        recognizerModelId,
        config.NEXT_PUBLIC_APP_URL,
      );

      // 4. Crop each region into a buffer
      const cropItems: CropInput[] = [];
      for (const reg of regions) {
        const geom = reg.geometry as { x: number; y: number; width: number; height: number };
        const left = Math.max(0, Math.min(imgWidth - 1, Math.round(geom.x)));
        const top = Math.max(0, Math.min(imgHeight - 1, Math.round(geom.y)));
        const width = Math.max(4, Math.min(imgWidth - left, Math.round(geom.width)));
        const height = Math.max(4, Math.min(imgHeight - top, Math.round(geom.height)));

        const cropBuffer = await sharp(pageImageBuffer)
          .extract({ left, top, width, height })
          .png()
          .toBuffer();

        cropItems.push({
          lineIndex: reg.reading_order,
          regionId: reg.id,
          imageBuffer: cropBuffer,
          mimeType: 'image/png',
        });
      }

      // 5. Process in batches
      const batchSize = Math.max(1, config.RECOGNITION_BATCH_SIZE || 5);
      let completedCount = 0;
      let failedCount = 0;

      for (let i = 0; i < cropItems.length; i += batchSize) {
        const batch = cropItems.slice(i, i + batchSize);
        let batchResults: RecognizedLine[] = [];

        try {
          batchResults = await recognizer.recognizeBatch(batch);
        } catch (batchErr) {
          // If remote API fails for this batch, mark them failed so pipeline continues
          batchResults = batch.map((item) => ({
            lineIndex: item.lineIndex,
            regionId: item.regionId,
            text: '',
            status: 'failed',
          }));
        }

        // Persist line results into database
        for (const res of batchResults) {
          if (res.status === 'succeeded') {
            completedCount++;
          } else {
            failedCount++;
          }

          // Upsert into line_results
          await db.from('line_results').upsert(
            {
              job_id: jobId,
              region_id: res.regionId,
              raw_text: res.text,
              status: res.status,
              attempt: 1,
            },
            { onConflict: 'job_id,region_id,attempt' },
          );
        }

        // Update live progress in job
        await db
          .from('jobs')
          .update({
            completed_count: completedCount,
            failed_count: failedCount,
            updated_at: new Date().toISOString(),
          })
          .eq('id', jobId);
      }

      // 6. Determine final job status
      let finalJobStatus: JobStatus = 'succeeded';
      if (failedCount > 0 && completedCount > 0) {
        finalJobStatus = 'partial';
      } else if (failedCount > 0 && completedCount === 0) {
        finalJobStatus = 'failed';
      }

      await db
        .from('jobs')
        .update({
          status: finalJobStatus,
          completed_count: completedCount,
          failed_count: failedCount,
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      // 7. Update document state
      const nextDocState = finalJobStatus === 'failed' ? 'failed' : 'completed';
      await db
        .from('documents')
        .update({ state: nextDocState, updated_at: new Date().toISOString() })
        .eq('id', job.document_id);

      // 8. Mark outbox dispatched
      await db
        .from('job_outbox')
        .update({ dispatch_state: 'dispatched' })
        .eq('job_id', jobId);

      return {
        id: job.id,
        documentId: job.document_id,
        ownerId: job.owner_id,
        kind: job.kind,
        status: finalJobStatus,
        completedCount,
        failedCount,
        totalCount: cropItems.length,
        workflowId: job.workflow_id,
        errorCode: null,
        createdAt: job.created_at,
        updatedAt: new Date().toISOString(),
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Ошибка при распознавании текста';
      await db
        .from('jobs')
        .update({
          status: 'failed',
          error_code: 'RECOGNITION_FAILED',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      await db
        .from('job_outbox')
        .update({ dispatch_state: 'failed' })
        .eq('job_id', jobId);

      throw err instanceof HttpError
        ? err
        : new HttpError(errorMsg, 'RECOGNITION_EXECUTION_FAILED', 502, true);
    }
  }

  /**
   * Fetches all line results for a given document.
   */
  static async getLineResults(
    documentId: string,
    ownerId: string,
    client?: SupabaseClient,
  ): Promise<LineResultDto[]> {
    const db = client || createAdminSupabaseClient();

    // Verify document ownership
    const { data: doc, error: docError } = await db
      .from('documents')
      .select('id, owner_id')
      .eq('id', documentId)
      .single();

    if (docError || !doc || doc.owner_id !== ownerId) {
      throw new HttpError('Доступ к документу ограничен.', 'DOCUMENT_FORBIDDEN', 403, false);
    }

    // Find latest recognition job
    const { data: latestJob } = await db
      .from('jobs')
      .select('id')
      .eq('document_id', documentId)
      .eq('kind', 'recognition')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestJob) {
      return [];
    }

    // Fetch line results
    const { data: results, error: resError } = await db
      .from('line_results')
      .select(`
        id,
        job_id,
        region_id,
        crop_asset_id,
        attempt,
        raw_text,
        status,
        created_at,
        regions (
          reading_order,
          geometry
        ),
        text_edits (
          edited_text,
          version
        )
      `)
      .eq('job_id', latestJob.id);

    if (resError || !results) {
      return [];
    }

    return results
      .map((row: any) => {
        const region = row.regions;
        const textEdit = Array.isArray(row.text_edits) && row.text_edits.length > 0 ? row.text_edits[0] : null;

        return {
          id: row.id,
          jobId: row.job_id,
          regionId: row.region_id,
          cropAssetId: row.crop_asset_id,
          attempt: row.attempt,
          rawText: row.raw_text,
          status: row.status,
          createdAt: row.created_at,
          readingOrder: region?.reading_order ?? 0,
          geometry: region?.geometry,
          editedText: textEdit?.edited_text,
        };
      })
      .sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0));
  }
}
