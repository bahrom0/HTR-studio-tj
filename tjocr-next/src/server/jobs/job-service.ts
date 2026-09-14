import { createAdminSupabaseClient } from '../supabase/admin';
import { JobDto, JobStatus } from '@/domain/types';
import { SupabaseClient } from '@supabase/supabase-js';

export class JobService {
  /**
   * Creates a durable test job and registers it in the job outbox.
   */
  static async createTestJob(params: {
    documentId: string;
    ownerId: string;
    simulateFailure?: boolean;
    client?: SupabaseClient;
  }): Promise<JobDto> {
    const db = params.client || createAdminSupabaseClient();

    // 1. Insert into jobs table
    const { data: job, error: jobError } = await db
      .from('jobs')
      .insert({
        document_id: params.documentId,
        owner_id: params.ownerId,
        kind: 'test_step',
        status: 'queued',
        total_count: 1,
        completed_count: 0,
        failed_count: 0,
      })
      .select()
      .single();

    if (jobError || !job) {
      throw new Error(`Failed to create test job: ${jobError?.message}`);
    }

    // 2. Insert into job_outbox
    const { error: outboxError } = await db
      .from('job_outbox')
      .insert({
        job_id: job.id,
        dispatch_state: 'pending',
        payload: {
          simulateFailure: Boolean(params.simulateFailure),
          documentId: params.documentId,
        },
      });

    if (outboxError) {
      console.error('Failed to create outbox record:', outboxError);
    }

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

  /**
   * Executes a durable step.
   * Handles simulated step failure and recovery.
   */
  static async executeStep(jobId: string, simulateFailure = false, client?: SupabaseClient): Promise<JobDto> {
    const db = client || createAdminSupabaseClient();

    // Update status to running
    await db
      .from('jobs')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', jobId);

    if (simulateFailure) {
      // Simulate transient step failure
      const { data: updatedJob, error } = await db
        .from('jobs')
        .update({
          status: 'failed',
          failed_count: 1,
          error_code: 'SIMULATED_TRANSIENT_STEP_FAILURE',
          updated_at: new Date().toISOString(),
        })
        .eq('id', jobId)
        .select()
        .single();

      if (error || !updatedJob) throw new Error('Failed to record failure state');

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
    }

    // Mark succeeded
    const { data: updatedJob, error } = await db
      .from('jobs')
      .update({
        status: 'succeeded',
        completed_count: 1,
        failed_count: 0,
        error_code: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', jobId)
      .select()
      .single();

    if (error || !updatedJob) throw new Error('Failed to record success state');

    // Update outbox state to dispatched
    await db
      .from('job_outbox')
      .update({ dispatch_state: 'dispatched' })
      .eq('job_id', jobId);

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
  }

  /**
   * Retries a failed job, demonstrating durable recovery.
   */
  static async retryJob(jobId: string, ownerId: string, client?: SupabaseClient): Promise<JobDto> {
    const db = client || createAdminSupabaseClient();

    const { data: existingJob, error } = await db
      .from('jobs')
      .select()
      .eq('id', jobId)
      .single();

    if (error || !existingJob) {
      throw new Error('Задача не найдена');
    }

    if (existingJob.owner_id !== ownerId) {
      throw new Error('Доступ запрещен');
    }

    // Execute step cleanly without simulated failure
    return this.executeStep(jobId, false, db);
  }

  /**
   * Fetches job status verifying owner access.
   */
  static async getJob(jobId: string, ownerId: string, client?: SupabaseClient): Promise<JobDto | null> {
    const db = client || createAdminSupabaseClient();

    const { data: job, error } = await db
      .from('jobs')
      .select()
      .eq('id', jobId)
      .eq('owner_id', ownerId)
      .single();

    if (error || !job) {
      return null;
    }

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
}
