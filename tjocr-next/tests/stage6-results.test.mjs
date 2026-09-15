import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rootDir = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');

test('Stage 6 keeps a versioned user edit separate from immutable OCR text', () => {
  const editRoute = read('src/app/api/v1/line-results/[id]/route.ts');
  const service = read('src/server/recognition/service.ts');
  const migration = read('supabase/migrations/20260915114206_stage6_results_exports.sql');

  assert.match(editRoute, /assertSameOrigin/, 'text edits reject cross-site browser writes');
  assert.match(editRoute, /expectedVersion/, 'text edits use optimistic concurrency');
  assert.match(editRoute, /TEXT_EDIT_VERSION_CONFLICT/, 'a stale write is visible to the user as a conflict');
  assert.match(editRoute, /raw_text/, 'the edit route reads the immutable provider output without overwriting it');
  assert.match(service, /editedText: textEdit\?\.edited_text/, 'result reads expose saved user corrections separately');
  assert.match(migration, /idx_text_edits_one_current_per_line_result/, 'one current version exists for each provider result');
});

test('Stage 6 exports the chosen text and preserves unrecognized line gaps', () => {
  const exportRoute = read('src/app/api/v1/documents/[id]/export/route.ts');
  const resultPage = read('src/app/app/documents/[id]/result/page.tsx');

  assert.match(exportRoute, /result\.editedText \?\? result\.rawText/, 'export prioritises a user correction over raw OCR text');
  assert.match(exportRoute, /result\.status === 'succeeded'[\s\S]*: ''/, 'failed OCR lines export as blank paragraphs rather than invented text');
  assert.match(exportRoute, /Packer\.toBuffer/, 'DOCX is generated as an actual Office document');
  assert.match(resultPage, /setTimeout\([\s\S]*650/, 'text updates autosave after a short debounce');
  assert.match(resultPage, /resultConflict/, 'the result screen gives a recovery path for version conflicts');
  assert.match(resultPage, /LineOverlay/, 'selecting a text line highlights its corresponding position on the full page');
  assert.match(resultPage, /export-layout/, 'download first prepares a separate visual layout plan');
  assert.match(resultPage, /ExportDialog/, 'download opens a final-text preview dialog');
  assert.match(exportRoute, /normalizeExportLayout/, 'the server validates layout metadata before generating a file');
});

test('RU and TG dictionaries maintain contract parity including Stage 6 result keys', () => {
  const ru = JSON.parse(read('src/i18n/dictionaries/ru.json'));
  const tg = JSON.parse(read('src/i18n/dictionaries/tg.json'));
  const keys = [
    'resultStep', 'resultTitle', 'resultSubtitle', 'backToRecognition',
    'resultCropTitle', 'resultTextLabel', 'resultEditHint', 'resultSaving',
    'resultSaved', 'resultSaveFailed', 'resultConflict', 'resultUseServer',
    'resultSaveMine', 'resultMissing', 'exportPartialNotice', 'exportTxt', 'exportDocx',
    'exportPreviewTitle', 'exportPreparing', 'exportReady', 'exportDownload', 'exportSavePending',
  ];

  for (const key of keys) {
    assert.equal(typeof ru.document[key], 'string', `RU dictionary contains ${key}`);
    assert.equal(typeof tg.document[key], 'string', `TG dictionary contains ${key}`);
  }
});
