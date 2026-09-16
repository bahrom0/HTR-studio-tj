import { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { createAdminSupabaseClient, hasSupabaseServerKey } from '@/server/supabase/admin';
import { getServerConfig } from '@/server/config';
import { JobDto, JobStatus, LineResultDto } from '@/domain/types';
import { HttpError } from '@/server/security/request';
import { getOCRPipeline, type CropInput, type RecognizedLine } from '@/ocr';

// A fast worker has two minutes to finish before the durable reconciler is
// permitted to claim the same persisted job after an interrupted process.
const FAST_PATH_RECOVERY_DELAY_MS = 2 * 60 * 1000;

function jobDto(job: any): JobDto {
  return {
    id: job.id,
    documentId: job.document_id,
    ownerId: job.owner_id,
    kind: job.kind,
    status: job.status as JobStatus,
    completedCount: job.completed_count,
    failedCount: job.failed_count,
    totalCount: job.total_count,
    workflowId: job.workflow_id,
    errorCode: job.error_code,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

export class RecognitionJobService {
  /**
   * A workflow does not inherit the browser's Supabase session. Check all
   * server-only requirements before a user-owned row is put into the queue;
   * otherwise the UI would show a job which no worker can ever complete.
   */
  static assertWorkerConfiguration() {
    const config = getServerConfig();
    if (!hasSupabaseServerKey(config)) {
      throw new HttpError(
        'Сервер распознавания не настроен: отсутствует серверный ключ базы данных.',
        'RECOGNITION_WORKER_CONFIG_MISSING',
        503,
        false,
      );
    }
    getOCRPipeline().assertConfiguration();
    return config;
  }

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
    RecognitionJobService.assertWorkerConfiguration();
    const db = client || createAdminSupabaseClient();
    const startedAt = Date.now();
    let phaseStartedAt = startedAt;
    const logStartTiming = (phase: string) => {
      const now = Date.now();
      console.info('[ocr:start-timing]', {
        pageId,
        phase,
        phaseMs: now - phaseStartedAt,
        elapsedMs: now - startedAt,
      });
      phaseStartedAt = now;
    };

    // 1. Verify page ownership
    const { data: page, error: pageError } = await db
      .from('pages')
      .select('id, document_id, width, height, image_revision, normalized_asset_id, source_asset_id')
      .eq('id', pageId)
      .single();

    if (pageError || !page) {
      throw new HttpError('Страница не найдена.', 'PAGE_NOT_FOUND', 404, false);
    }
    logStartTiming('page_loaded');

    // Both lookups only depend on pageId/page.document_id. Running them as one
    // round-trip saves an entire Supabase request on every OCR start.
    const documentQuery = db
      .from('documents')
      .select('id, owner_id, state')
      .eq('id', page.document_id)
      .single();

    const latestRevisionQuery = revisionId
      ? Promise.resolve({ data: null })
      : db
          .from('region_revisions')
          .select('id')
          .eq('page_id', pageId)
          .order('revision_number', { ascending: false })
          .limit(1)
          .maybeSingle();

    const [
      { data: document, error: docError },
      { data: latestRev },
    ] = await Promise.all([documentQuery, latestRevisionQuery]);

    if (docError || !document || document.owner_id !== ownerId) {
      throw new HttpError('Доступ к документу ограничен.', 'DOCUMENT_FORBIDDEN', 403, false);
    }

    // 2. Resolve the target revision
    const targetRevId = revisionId ?? latestRev?.id;

    if (!targetRevId) {
      throw new HttpError(
        'Не найдена разметка строк для распознавания. Сначала разметьте строки.',
        'REVISION_NOT_FOUND',
        400,
        false,
      );
    }

    const idempotencyKey = `recognition:${pageId}:${targetRevId}`;

    // Revision confirmation, region loading and the idempotency check are
    // independent. They used to take three serial HTTP round-trips before a
    // job could be inserted.
    const [
      ,
      { data: regions, error: regionsError },
      { data: activeJob },
    ] = await Promise.all([
      db
        .from('region_revisions')
        .update({ confirmed_at: new Date().toISOString() })
        .eq('id', targetRevId),
      db
        .from('regions')
        .select('id, reading_order, geometry, excluded')
        .eq('revision_id', targetRevId)
        .eq('excluded', false)
        .order('reading_order', { ascending: true }),
      db
        .from('jobs')
        .select('*')
        .eq('document_id', page.document_id)
        .eq('kind', 'recognition')
        .eq('revision_id', targetRevId)
        .in('status', ['queued', 'running'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    logStartTiming('job_preflight_complete');

    if (regionsError || !regions || regions.length === 0) {
      throw new HttpError(
        'Нет активных строк для распознавания.',
        'NO_ACTIVE_REGIONS',
        400,
        false,
      );
    }

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
        idempotency_key: idempotencyKey,
      })
      .select()
      .single();

    if (jobError || !newJob) {
      // The unique idempotency index resolves simultaneous double-clicks and
      // duplicate HTTP delivery without starting a second paid OCR run.
      if (jobError?.code === '23505') {
        const { data: existingJob } = await db
          .from('jobs')
          .select('*')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existingJob) {
          return {
            alreadyRunning: true,
            job: {
              id: existingJob.id,
              documentId: existingJob.document_id,
              ownerId: existingJob.owner_id,
              kind: existingJob.kind,
              status: existingJob.status as JobStatus,
              completedCount: existingJob.completed_count,
              failedCount: existingJob.failed_count,
              totalCount: existingJob.total_count,
              workflowId: existingJob.workflow_id,
              errorCode: existingJob.error_code,
              createdAt: existingJob.created_at,
              updatedAt: existingJob.updated_at,
            },
          };
        }
      }
      throw new HttpError(
        'Не удалось создать задачу распознавания.',
        'JOB_CREATION_FAILED',
        503,
        true,
      );
    }
    logStartTiming('job_inserted');

    // The fast worker is scheduled only after this method returns, so these
    // independent writes can safely share one final network round-trip.
    await Promise.all([
      db.from('job_outbox').insert({
        job_id: newJob.id,
        dispatch_state: 'pending',
        next_attempt_at: new Date(Date.now() + FAST_PATH_RECOVERY_DELAY_MS).toISOString(),
        payload: {
          pageId,
          documentId: page.document_id,
          revisionId: targetRevId,
          lineCount: regions.length,
        },
      }),
      db
        .from('documents')
        .update({ state: 'recognizing', updated_at: new Date().toISOString() })
        .eq('id', page.document_id),
    ]);
    logStartTiming('job_ready');

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
    const config = RecognitionJobService.assertWorkerConfiguration();
    const db = client || createAdminSupabaseClient();
    const workerStartedAt = Date.now();
    let phaseStartedAt = workerStartedAt;
    const logTiming = (phase: string, extra: Record<string, number | string> = {}) => {
      const now = Date.now();
      console.info('[ocr:timing]', {
        jobId,
        worker: ownerId,
        phase,
        phaseMs: now - phaseStartedAt,
        elapsedMs: now - workerStartedAt,
        ...extra,
      });
      phaseStartedAt = now;
    };

    try {
      logTiming('worker_started');
      // 1. Fetch job with revision and page
      const { data: initialJob, error: jobError } = await db
        .from('jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (jobError || !initialJob) {
        throw new HttpError('Задача не найдена.', 'JOB_NOT_FOUND', 404, false);
      }

      // A cancellation must win over a delayed or duplicate workflow start.
      // This is deliberately checked before the queued -> running transition.
      if (initialJob.status === 'cancelling' || initialJob.status === 'cancelled') {
        const { data: cancelledJob, error: cancelError } = await db
          .from('jobs')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', jobId)
          .in('status', ['cancelling', 'cancelled'])
          .select()
          .single();
        if (cancelError || !cancelledJob) {
          throw new HttpError('Не удалось зафиксировать отмену задачи.', 'JOB_CANCEL_FAILED', 503, true);
        }
        await db.from('documents').update({ state: 'lines_ready', updated_at: new Date().toISOString() }).eq('id', cancelledJob.document_id);
        await db.from('job_outbox').update({ dispatch_state: 'dispatched' }).eq('job_id', jobId);
        return jobDto(cancelledJob);
      }

      if (['succeeded', 'partial', 'failed'].includes(initialJob.status)) {
        return jobDto(initialJob);
      }

      // Claim the queued job exactly once. A second dispatch returns the
      // current state instead of sending the same paid batch to the runtime.
      const claimCutoff = new Date(Date.now() - FAST_PATH_RECOVERY_DELAY_MS).toISOString();
      let claimRequest = db
        .from('jobs')
        .update({ status: 'running', updated_at: new Date().toISOString() })
        .eq('id', jobId);
      claimRequest = ownerId === 'workflow'
        ? claimRequest.in('status', ['queued', 'running']).lt('updated_at', claimCutoff)
        : claimRequest.eq('status', 'queued');
      const { data: claimedJob, error: claimError } = await claimRequest.select().maybeSingle();
      if (claimError) {
        throw new HttpError('Не удалось запустить задачу распознавания.', 'JOB_CLAIM_FAILED', 503, true);
      }
      if (!claimedJob) {
        const { data: currentJob, error: currentJobError } = await db.from('jobs').select('*').eq('id', jobId).single();
        if (currentJobError || !currentJob) {
          throw new HttpError('Задача не найдена.', 'JOB_NOT_FOUND', 404, false);
        }
        return jobDto(currentJob);
      }
      const job = claimedJob;
      logTiming('job_claimed');

      // These reads are independent of the page asset download. Start them
      // together so the worker spends its first network round-trip once.
      const pageRequest = db
        .from('pages')
        .select('id, document_id, width, height, normalized_asset_id, source_asset_id')
        .eq('document_id', job.document_id)
        .single();
      const regionsRequest = db
        .from('regions')
        .select('id, reading_order, geometry, excluded')
        .eq('revision_id', job.revision_id)
        .eq('excluded', false)
        .order('reading_order', { ascending: true });
      const outboxRequest = db
        .from('job_outbox')
        .select('payload')
        .eq('job_id', jobId)
        .maybeSingle();
      const [pageResponse, regionsResponse, outboxResponse] = await Promise.all([
        pageRequest,
        regionsRequest,
        outboxRequest,
      ]);
      logTiming('job_inputs_loaded');
      const { data: page, error: pageError } = pageResponse;

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
      logTiming('asset_loaded');

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
      logTiming('page_image_downloaded', { bytes: pageImageBuffer.length });
      const imgWidth = imageMeta.width || page.width || 2048;
      const imgHeight = imageMeta.height || page.height || 2048;

      // 2. Regions and retry payload were fetched while the page image was
      // being resolved and downloaded above.
      const { data: regions, error: regionsError } = regionsResponse;

      if (regionsError || !regions || regions.length === 0) {
        throw new HttpError('Не найдены строки для распознавания.', 'NO_REGIONS_FOUND', 400, false);
      }

      const { data: outbox } = outboxResponse;
      const payload = (outbox?.payload || {}) as { retryRegionIds?: string[]; retryAttempt?: number };
      const retryRegionIds = Array.isArray(payload.retryRegionIds) ? new Set(payload.retryRegionIds) : null;
      const regionsToRecognize = retryRegionIds
        ? regions.filter((region) => retryRegionIds.has(region.id))
        : regions;

      if (regionsToRecognize.length === 0) {
        throw new HttpError('Нет строк, доступных для повторного распознавания.', 'NO_RETRYABLE_REGIONS', 409, false);
      }

      // 3. Initialize the application OCR runtime once for this job.
      const ocrPipeline = getOCRPipeline();
      await ocrPipeline.initialize();

      // 4. Crop each region into a buffer
      const cropItems: CropInput[] = await Promise.all(regionsToRecognize.map(async (reg) => {
        const geom = reg.geometry as { x: number; y: number; width: number; height: number };
        const left = Math.max(0, Math.min(imgWidth - 1, Math.round(geom.x)));
        const top = Math.max(0, Math.min(imgHeight - 1, Math.round(geom.y)));
        const width = Math.max(4, Math.min(imgWidth - left, Math.round(geom.width)));
        const height = Math.max(4, Math.min(imgHeight - top, Math.round(geom.height)));

        const cropBuffer = await sharp(pageImageBuffer)
          .extract({ left, top, width, height })
          .png()
          .toBuffer();

        return {
          lineIndex: reg.reading_order,
          regionId: reg.id,
          imageBuffer: cropBuffer,
          mimeType: 'image/png',
        };
      }));
      logTiming('crops_ready', { regions: cropItems.length });

      // 5. Process four-line runtime batches in bounded parallel pairs. Two
      // requests begin together; their combined result is written by one bulk
      // upsert, so live progress is based only on durable rows.
      const { batchSize, batchConcurrency } = ocrPipeline.getExecutionConfig();
      const batches: CropInput[][] = [];
      for (let i = 0; i < cropItems.length; i += batchSize) {
        batches.push(cropItems.slice(i, i + batchSize));
      }
      let completedCount = job.completed_count;
      let failedCount = job.failed_count;
      const attempt = payload.retryAttempt || 1;

      for (let groupStart = 0; groupStart < batches.length; groupStart += batchConcurrency) {
        const { data: currentJob } = await db
          .from('jobs')
          .select('status, completed_count, failed_count, total_count, created_at, updated_at, workflow_id, error_code')
          .eq('id', jobId)
          .single();

        if (currentJob?.status === 'cancelling' || currentJob?.status === 'cancelled') {
          const { data: cancelledJob } = await db
            .from('jobs')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .eq('id', jobId)
            .select()
            .single();

          await db.from('documents').update({ state: 'lines_ready', updated_at: new Date().toISOString() }).eq('id', job.document_id);
          await db.from('job_outbox').update({ dispatch_state: 'dispatched' }).eq('job_id', jobId);

          const terminalJob = cancelledJob || { ...job, ...currentJob, status: 'cancelled' };
          return {
            id: terminalJob.id,
            documentId: terminalJob.document_id,
            ownerId: terminalJob.owner_id,
            kind: terminalJob.kind,
            status: 'cancelled',
            completedCount: terminalJob.completed_count,
            failedCount: terminalJob.failed_count,
            totalCount: terminalJob.total_count,
            workflowId: terminalJob.workflow_id,
            errorCode: terminalJob.error_code,
            createdAt: terminalJob.created_at,
            updatedAt: terminalJob.updated_at,
          };
        }

        const activeBatches = batches.slice(groupStart, groupStart + batchConcurrency);
        // map starts both network calls before either result is awaited.
        const pendingResults = activeBatches.map((batch, offset) =>
          ocrPipeline
            .recognizeBatch(batch, `${jobId}:attempt:${attempt}:batch:${groupStart + offset}`)
            .catch((): RecognizedLine[] => batch.map((item) => ({
              lineIndex: item.lineIndex,
              regionId: item.regionId,
              text: '',
              status: 'failed',
            }))),
        );

        // Both requests are settled before one bulk write saves the pair (up to
        // eight lines). Progress therefore advances by a real durable group,
        // while cancellation remains bounded to the active pair.
        const batchResults = (await Promise.all(pendingResults)).flat();
        logTiming('runtime_group_complete', {
          groupStart,
          requests: activeBatches.length,
          regions: batchResults.length,
        });
        const { error: persistError } = await db.from('line_results').upsert(
          batchResults.map((res) => ({
            job_id: jobId,
            region_id: res.regionId,
            raw_text: res.text,
            status: res.status,
            attempt,
          })),
          { onConflict: 'job_id,region_id,attempt' },
        );
        if (persistError) {
          throw new HttpError('Не удалось сохранить распознанные строки.', 'LINE_RESULT_PERSIST_FAILED', 503, true);
        }
        logTiming('runtime_group_persisted', { groupStart, regions: batchResults.length });
        completedCount += batchResults.filter((result) => result.status === 'succeeded').length;
        failedCount += batchResults.filter((result) => result.status === 'failed').length;

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
      // 7–8. Neither update depends on the other; keep completion visible as
      // soon as the job row has been committed above.
      await Promise.all([
        db
          .from('documents')
          .update({ state: nextDocState, updated_at: new Date().toISOString() })
          .eq('id', job.document_id),
        db
          .from('job_outbox')
          .update({ dispatch_state: 'dispatched' })
          .eq('job_id', jobId),
      ]);
      logTiming('job_completed', { completedCount, failedCount });

      return {
        id: job.id,
        documentId: job.document_id,
        ownerId: job.owner_id,
        kind: job.kind,
        status: finalJobStatus,
        completedCount,
        failedCount,
        totalCount: job.total_count,
        workflowId: job.workflow_id,
        errorCode: null,
        createdAt: job.created_at,
        updatedAt: new Date().toISOString(),
      };
    } catch (err: unknown) {
      logTiming('job_failed', { message: err instanceof Error ? err.name : 'unknown' });
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
        : new HttpError('Recognition request failed.', 'OCR_RECOGNITION_FAILED', 502, true);
    }
  }

  /** Requeues only the most recent failed result for every failed region. */
  static async retryRecognitionJob(jobId: string, ownerId: string, client?: SupabaseClient): Promise<JobDto> {
    const db = client || createAdminSupabaseClient();
    const { data: job, error: jobError } = await db.from('jobs').select('*').eq('id', jobId).single();
    if (jobError || !job || job.owner_id !== ownerId || job.kind !== 'recognition') {
      throw new HttpError('Задача распознавания не найдена.', 'JOB_NOT_FOUND', 404, false);
    }
    if (['queued', 'running', 'cancelling'].includes(job.status)) {
      return {
        id: job.id, documentId: job.document_id, ownerId: job.owner_id, kind: job.kind,
        status: job.status as JobStatus, completedCount: job.completed_count, failedCount: job.failed_count,
        totalCount: job.total_count, workflowId: job.workflow_id, errorCode: job.error_code,
        createdAt: job.created_at, updatedAt: job.updated_at,
      };
    }

    const { data: rows, error: rowsError } = await db
      .from('line_results')
      .select('region_id, status, attempt')
      .eq('job_id', jobId)
      .order('attempt', { ascending: false });
    if (rowsError || !rows) throw new HttpError('Не удалось прочитать результаты задачи.', 'LINE_RESULTS_READ_FAILED', 503, true);

    const latestByRegion = new Map<string, { status: string; attempt: number }>();
    for (const row of rows) {
      if (!latestByRegion.has(row.region_id)) latestByRegion.set(row.region_id, row);
    }

    const { data: regions, error: regionsError } = await db
      .from('regions')
      .select('id')
      .eq('revision_id', job.revision_id)
      .eq('excluded', false);
    if (regionsError || !regions?.length) {
      throw new HttpError('Не удалось прочитать строки для повтора.', 'RETRY_REGIONS_READ_FAILED', 503, true);
    }

    // A cancelled or crashed run can have no result at all for a region.
    // Resume those rows too, while preserving every already-successful line.
    const retryRegionIds = regions
      .map((region) => region.id)
      .filter((regionId) => latestByRegion.get(regionId)?.status !== 'succeeded');
    if (retryRegionIds.length === 0) {
      throw new HttpError('Нет нераспознанных строк для повтора.', 'NO_RETRYABLE_REGIONS', 409, false);
    }

    const completedCount = [...latestByRegion.values()].filter((row) => row.status === 'succeeded').length;
    const retryAttempt = Math.max(...[...latestByRegion.values()].map((row) => row.attempt), 0) + 1;
    const { data: existingOutbox } = await db.from('job_outbox').select('payload, attempts').eq('job_id', jobId).single();
    const { data: updatedJob, error: updateError } = await db
      .from('jobs')
      .update({
        status: 'queued', completed_count: completedCount, failed_count: 0, error_code: null,
        workflow_id: null, updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .select()
      .single();
    if (updateError || !updatedJob) throw new HttpError('Не удалось поставить повтор в очередь.', 'JOB_RETRY_FAILED', 503, true);

    const { error: outboxError } = await db.from('job_outbox').update({
      dispatch_state: 'pending',
      attempts: (existingOutbox?.attempts || 0) + 1,
      next_attempt_at: new Date(Date.now() + FAST_PATH_RECOVERY_DELAY_MS).toISOString(),
      payload: { ...(existingOutbox?.payload || {}), retryRegionIds, retryAttempt },
    }).eq('job_id', jobId);
    if (outboxError) throw new HttpError('Не удалось сохранить повтор в outbox.', 'OUTBOX_RETRY_FAILED', 503, true);

    await db.from('documents').update({ state: 'recognizing', updated_at: new Date().toISOString() }).eq('id', job.document_id);
    return {
      id: updatedJob.id, documentId: updatedJob.document_id, ownerId: updatedJob.owner_id,
      kind: updatedJob.kind, status: updatedJob.status as JobStatus,
      completedCount: updatedJob.completed_count, failedCount: updatedJob.failed_count,
      totalCount: updatedJob.total_count, workflowId: updatedJob.workflow_id,
      errorCode: updatedJob.error_code, createdAt: updatedJob.created_at, updatedAt: updatedJob.updated_at,
    };
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

    const latestByRegion = new Map<string, any>();
    for (const row of results) {
      const existing = latestByRegion.get(row.region_id);
      if (!existing || row.attempt > existing.attempt) latestByRegion.set(row.region_id, row);
    }

    return [...latestByRegion.values()]
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
          editVersion: textEdit?.version,
        };
      })
      .sort((a, b) => (a.readingOrder ?? 0) - (b.readingOrder ?? 0));
  }
}
