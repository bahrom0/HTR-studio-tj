import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

test('TrOCR runtime exposes the application OCR contract', () => {
  const runtime = read('src/ocr/runtime/trocr-runtime.ts');
  const pipeline = read('src/ocr/pipeline.ts');
  const types = read('src/ocr/types.ts');
  assert.match(runtime, /class TrOCRRuntime/);
  for (const method of ['initialize', 'recognize', 'recognizeBatch', 'healthCheck', 'getModelInfo']) assert.match(runtime, new RegExp(`${method}\\(`));
  assert.match(pipeline, /class OCRPipeline/);
  assert.match(pipeline, /new TrOCRRuntime/);
  assert.match(types, /family: 'TrOCR'/);
  assert.match(types, /task: 'handwritten-text-recognition'/);
  assert.match(types, /language: 'tg'/);
  assert.match(types, /kind: 'OCRDevice'/);
});

test('business services use OCRPipeline and direct transport lives in one adapter', () => {
  const recognition = read('src/server/recognition/service.ts');
  const detection = read('src/server/detection/service.ts');
  const layout = read('src/server/exports/layout-service.ts');
  const implementation = read('src/ocr/adapters/internal-provider.ts');
  const health = read('src/app/api/v1/ocr/health/route.ts');
  for (const source of [recognition, detection, layout]) {
    assert.match(source, /getOCRPipeline/);
    assert.doesNotMatch(source, /fetch\(/);
    assert.doesNotMatch(source, /OCR_API_|OPENROUTER|RECOGNIZER_MODEL|DETECTOR_MODEL/);
  }
  assert.match(implementation, /fetch\(/);
  assert.match(implementation, /OCR_INFERENCE_UNAVAILABLE/);
  assert.match(implementation, /OCR_INFERENCE_TIMEOUT/);
  assert.doesNotMatch(implementation, /response\.text\(/);
  assert.match(health, /healthCheck\(/);
  assert.doesNotMatch(health, /OCR_PROVIDER|OCR_API_|OPENROUTER/);
});

test('recognition batching and durable workflow contracts remain intact', () => {
  const service = read('src/server/recognition/service.ts');
  const workflow = read('src/workflows/recognition.ts');
  const startRoute = read('src/app/api/v1/pages/[id]/recognition-jobs/route.ts');
  assert.match(workflow, /'use workflow'/);
  assert.match(workflow, /'use step'/);
  assert.match(startRoute, /scheduleRecognitionFastPath/);
  assert.match(service, /idempotency_key/);
  assert.match(service, /pendingResults = activeBatches\.map/);
  assert.match(service, /await Promise\.all\(pendingResults\)/);
  assert.match(service, /batchResults\.map\(\(res\)/);
  assert.match(service, /hasSupabaseServerKey/);
  assert.match(service, /cancelling/);
  assert.match(service, /retryRegionIds/);
});

test('RU and TG dictionaries maintain Stage 5 parity', () => {
  const ru = JSON.parse(read('src/i18n/dictionaries/ru.json'));
  const tg = JSON.parse(read('src/i18n/dictionaries/tg.json'));
  for (const key of ['recognizingProgress', 'recognizeCompleted', 'recognizeFailed', 'lineStatusProcessing', 'lineStatusSuccess']) {
    assert.ok(ru.document[key], `ru.json missing document.${key}`);
    assert.ok(tg.document[key], `tg.json missing document.${key}`);
  }
});
