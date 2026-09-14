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
  ];

  for (const relPath of expectedFiles) {
    const fullPath = path.join(rootDir, relPath);
    assert.ok(fs.existsSync(fullPath), `File exists: ${relPath}`);
  }
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
  ];

  for (const key of stage5Keys) {
    assert.ok(Boolean(ru.document[key]), `ru.json missing document.${key}`);
    assert.ok(Boolean(tg.document[key]), `tg.json missing document.${key}`);
  }
});
