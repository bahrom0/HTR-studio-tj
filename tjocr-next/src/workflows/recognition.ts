import { RecognitionJobService } from '@/server/recognition/service';

/**
 * The workflow owns the lifetime of OCR.  The browser only creates a persisted
 * job and receives its id; closing the tab cannot interrupt this execution.
 */
export async function runRecognitionWorkflow(jobId: string) {
  'use workflow';

  return executeRecognitionStep(jobId);
}

async function executeRecognitionStep(jobId: string) {
  'use step';

  return RecognitionJobService.executeRecognition(jobId, 'workflow');
}
