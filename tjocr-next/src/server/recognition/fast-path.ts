import { after } from 'next/server';
import { RecognitionJobService } from './service';

/**
 * Starts the interactive worker after the HTTP response. Durable recovery is
 * intentionally not started here: the local Workflow dispatcher monopolizes
 * the dev server long enough to delay the OCR worker itself. The persisted
 * outbox is recovered by the maintenance route if this process disappears.
 */
export function scheduleRecognitionFastPath(jobId: string) {
  after(async () => {
    try {
      const job = await RecognitionJobService.executeRecognition(jobId, 'fast-path');
      console.info('[ocr:fast-path] completed', { jobId, status: job.status });
    } catch (error) {
      console.error('[ocr:fast-path] failed', {
        jobId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}
