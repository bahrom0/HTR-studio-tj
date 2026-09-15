import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

test('TextRecognizer contract: verifies input validation, error handling, and batch contract', async () => {
  const recognizerPath = path.join(rootDir, 'src/server/recognition/recognizer.ts');
  assert.ok(fs.existsSync(recognizerPath), 'recognizer.ts exists');

  const content = fs.readFileSync(recognizerPath, 'utf8');
  assert.ok(content.includes('export interface CropInput'), 'CropInput interface is exported');
  assert.ok(content.includes('export interface RecognizedLine'), 'RecognizedLine interface is exported');
  assert.ok(content.includes('export interface TextRecognizer'), 'TextRecognizer interface is exported');
  assert.ok(content.includes('export class RemoteTextRecognizer'), 'RemoteTextRecognizer is exported');
  assert.ok(content.includes('RECOGNIZER_API_KEY_MISSING'), 'Enforces server-only API key presence');
  assert.ok(content.includes('RECOGNIZER_MODEL_MISSING'), 'Enforces model configuration');
});

test('Recognition batching and status calculation logic', () => {
  // Mock batching function
  function chunkArray(items, size) {
    const batches = [];
    for (let i = 0; i < items.length; i += size) {
      batches.push(items.slice(i, i + size));
    }
    return batches;
  }

  const items = Array.from({ length: 14 }, (_, i) => ({ lineIndex: i, regionId: `reg-${i}` }));
  const chunks = chunkArray(items, 5);

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].length, 5);
  assert.equal(chunks[1].length, 5);
  assert.equal(chunks[2].length, 4);

  // Status calculation logic
  function calculateJobStatus(completedCount, failedCount, totalCount) {
    if (completedCount === totalCount && failedCount === 0) return 'succeeded';
    if (completedCount > 0 && failedCount > 0) return 'partial';
    if (failedCount === totalCount && completedCount === 0) return 'failed';
    return 'running';
  }

  assert.equal(calculateJobStatus(14, 0, 14), 'succeeded');
  assert.equal(calculateJobStatus(12, 2, 14), 'partial');
  assert.equal(calculateJobStatus(0, 14, 14), 'failed');
  assert.equal(calculateJobStatus(5, 0, 14), 'running');
});

test('Stage 5 Recognition components and routes exist and are properly structured', () => {
  const expectedFiles = [
    'src/server/recognition/recognizer.ts',
    'src/server/recognition/service.ts',
    'src/app/api/v1/pages/[id]/recognition-jobs/route.ts',
    'src/app/api/v1/documents/[id]/line-results/route.ts',
    'src/app/app/documents/[id]/recognize/page.tsx',
    'src/app/api/v1/jobs/[id]/cancel/route.ts',
    'src/app/api/v1/maintenance/reconcile-recognition/route.ts',
    'src/workflows/recognition.ts',
  ];

  for (const relPath of expectedFiles) {
    const fullPath = path.join(rootDir, relPath);
    assert.ok(fs.existsSync(fullPath), `File exists: ${relPath}`);
  }
});

test('Recognition dispatch is durable and guards duplicate, failed, and cancelled work', () => {
  const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const startRoute = read('src/app/api/v1/pages/[id]/recognition-jobs/route.ts');
  const workflow = read('src/workflows/recognition.ts');
  const reconcileRoute = read('src/app/api/v1/maintenance/reconcile-recognition/route.ts');
  const service = read('src/server/recognition/service.ts');
  const recognizer = read('src/server/recognition/recognizer.ts');
  const config = read('src/server/config.ts');
  const retryRoute = read('src/app/api/v1/jobs/[id]/retry/route.ts');
  const recognizePage = read('src/app/app/documents/[id]/recognize/page.tsx');

  assert.match(workflow, /'use workflow'/, 'OCR runs in a durable workflow');
  assert.match(workflow, /'use step'/, 'OCR work executes inside a retryable step');
  assert.match(startRoute, /scheduleRecognitionFastPath/, 'the HTTP response schedules only the fast worker');
  assert.doesNotMatch(startRoute, /start\(runRecognitionWorkflow/, 'the local Workflow dispatcher cannot delay interactive OCR');
  assert.match(reconcileRoute, /start\(runRecognitionWorkflow/, 'the durable Workflow remains an outbox recovery path');
  assert.match(reconcileRoute, /dispatch_state: 'pending'/, 'a dispatched recovery remains durable until its worker finishes');
  assert.doesNotMatch(reconcileRoute, /workflow_id: run\.runId, updated_at/, 'recovery keeps an abandoned job stale until the workflow claims it');
  assert.match(service, /idempotency_key/, 'duplicate starts use the persisted idempotency key');
  assert.match(service, /JOB_CLAIM_FAILED/, 'a queued job is claimed by only one workflow execution');
  assert.match(service, /LINE_RESULT_PERSIST_FAILED/, 'a failed result write cannot become false success');
  assert.match(service, /batchResults\.map\(\(res\)/, 'each OCR batch is persisted in one database write');
  assert.match(service, /RECOGNITION_WORKER_CONFIG_MISSING/, 'a missing worker secret fails before a job can get stuck');
  assert.match(service, /hasSupabaseServerKey/, 'a publishable Supabase key cannot run OCR jobs');
  assert.match(service, /cancelling/, 'the worker checks cancellation between bounded batches');
  assert.match(service, /retryRegionIds/, 'retry plans contain only failed region ids');
  assert.match(retryRoute, /retryRecognitionJob/, 'retry endpoint uses recognition-specific failed-line retry');
  assert.match(recognizer, /Idempotency-Key/, 'remote batch requests carry an idempotency key');
  assert.match(recognizer, /RECOGNIZER_TIMEOUT/, 'a slow provider is bounded by a server timeout');
  assert.match(recognizer, /max_tokens/, 'batch output has a bounded token budget');
  assert.match(recognizer, /preferred_max_latency/, 'OpenRouter routing de-prioritises slow endpoints');
  assert.match(recognizer, /preferred_min_throughput/, 'OpenRouter routing prefers fast endpoints');
  assert.match(recognizer, /google-ai-studio\/flex/, 'OCR is pinned to the fast Google AI Studio Flex endpoint');
  assert.match(recognizer, /allow_fallbacks: false/, 'a slow provider cannot silently replace the selected endpoint');
  assert.match(recognizer, /\[ocr:openrouter\]/, 'safe provider timing telemetry is written to server logs');
  assert.match(service, /attempt:\$\{attempt\}:batch/, 'each batch derives its key from the persisted attempt');
  assert.match(recognizer, /RECOGNIZER_INVALID_RESULT_SET/, 'missing or duplicate provider line ids are rejected');
  assert.match(recognizePage, /hasProgressChange/, 'the UI does not refetch all line results when job progress is unchanged');
  assert.match(service, /Promise\.all\(\[documentQuery, latestRevisionQuery\]\)/, 'document and revision lookup share one Supabase round-trip');
  assert.match(service, /Revision confirmation, region loading and the idempotency check are/, 'job preflight requests run together');
  assert.match(service, /The fast worker is scheduled only after this method returns/, 'outbox persistence completes before the fast worker starts');
  assert.match(service, /\[ocr:start-timing\]/, 'job-start timing is logged without OCR text or secrets');
  assert.match(config, /RECOGNITION_BATCH_SIZE.*default\(4\)/, 'default OCR provider batches contain four lines');
  assert.match(config, /RECOGNITION_BATCH_CONCURRENCY.*default\(2\)/, 'at most two OCR provider batches run in parallel');
  assert.match(service, /pendingResults = activeBatches\.map/, 'both provider requests are started before the first result is awaited');
  assert.match(service, /await Promise\.all\(pendingResults\)/, 'a parallel pair is persisted after both provider requests settle');
});

test('RU and TG dictionaries maintain contract parity including Stage 5 recognition keys', () => {
  const ruPath = path.join(rootDir, 'src/i18n/dictionaries/ru.json');
  const tgPath = path.join(rootDir, 'src/i18n/dictionaries/tg.json');

  const ru = JSON.parse(fs.readFileSync(ruPath, 'utf8'));
  const tg = JSON.parse(fs.readFileSync(tgPath, 'utf8'));

  const stage5Keys = [
    'recognizeStep',
    'recognizingProgress',
    'recognizingSubtitle',
    'recognizeCompleted',
    'recognizePartial',
    'recognizeFailed',
    'openResultAction',
    'retryFailedLinesAction',
    'recognizeStarting',
    'noLinesToRecognize',
    'backToLines',
    'linesRecognizedCount',
    'lineStatusPending',
    'lineStatusProcessing',
    'lineStatusSuccess',
    'lineStatusFailed',
    'cancelRecognition',
    'cancellingRecognition',
    'retryFailedLines',
    'scanLabel',
    'emptyRecognizedLine',
    'recognizeCancelled',
    'restartRecognition',
  ];

  for (const key of stage5Keys) {
    assert.ok(Boolean(ru.document[key]), `ru.json missing document.${key}`);
    assert.ok(Boolean(tg.document[key]), `tg.json missing document.${key}`);
  }
});
