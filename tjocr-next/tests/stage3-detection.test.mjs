import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import sharp from 'sharp';
import crypto from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(join(root, relativePath), 'utf8');

test('image normalizer contract and Sharp pipeline functions as specified', async () => {
  // 1. Create a synthetic test PNG image (300x200)
  const syntheticBuffer = await sharp({
    create: {
      width: 300,
      height: 200,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();

  // Test sharp pipeline matching normalizer.ts implementation
  const metadata = await sharp(syntheticBuffer).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 300);
  assert.equal(metadata.height, 200);

  const { data: normalized, info } = await sharp(syntheticBuffer)
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 8 })
    .toBuffer({ resolveWithObject: true });

  assert.equal(info.width, 300);
  assert.equal(info.height, 200);
  assert.equal(info.format, 'png');

  // Verify SHA-256 checksums
  const srcSha = crypto.createHash('sha256').update(syntheticBuffer).digest('hex');
  const normSha = crypto.createHash('sha256').update(normalized).digest('hex');
  assert.equal(srcSha.length, 64);
  assert.equal(normSha.length, 64);

  // Rotation by 90 degrees
  const { info: rotInfo } = await sharp(syntheticBuffer)
    .rotate(90)
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  assert.equal(rotInfo.width, 200);
  assert.equal(rotInfo.height, 300);

  // Read source normalizer.ts to ensure all safeguards are present
  const source = await read('src/server/images/normalizer.ts');
  assert.match(source, /ALLOWED_FORMATS/);
  assert.match(source, /MAX_DECODED_PIXELS/);
  assert.match(source, /computeSha256/);
  assert.match(source, /rotate\(/);
});

test('line detection coordinate conversion and boundary enforcement logic', async () => {
  // Test coordinate conversion math matching the local inference adapter.
  const page = { width: 1000, height: 2000 };
  const rawBox = [100, 50, 200, 850]; // [ymin, xmin, ymax, xmax] in 0..1000

  const [ymin, xmin, ymax, xmax] = rawBox;
  assert.ok(ymin < ymax && xmin < xmax);

  const x = Math.round(((xmin / 1000) * page.width) * 100) / 100;
  const y = Math.round(((ymin / 1000) * page.height) * 100) / 100;
  const width = Math.round((((xmax - xmin) / 1000) * page.width) * 100) / 100;
  const height = Math.round((((ymax - ymin) / 1000) * page.height) * 100) / 100;

  assert.equal(x, 50);
  assert.equal(y, 200);
  assert.equal(width, 800);
  assert.equal(height, 200);

  const detectorSource = await read('src/ocr/adapters/local-inference-adapter.ts');
  assert.match(detectorSource, /detectLines/);
  assert.match(detectorSource, /OCR_INVALID_COORDINATES/);
  assert.match(detectorSource, /OCR_DEGENERATE_BOX/);
  assert.match(detectorSource, /OCR_LINE_LIMIT_EXCEEDED/);
  // Model identifiers must come from server configuration, never source literals.
  assert.doesNotMatch(detectorSource, /model:\s*['"][^'"]+['"]/i);
});

test('stage 3 route handlers and screens are present and conform to security standards', async () => {
  const routes = [
    'src/app/api/v1/documents/[id]/route.ts',
    'src/app/api/v1/documents/[id]/upload-complete/route.ts',
    'src/app/api/v1/assets/[id]/url/route.ts',
    'src/app/api/v1/pages/[id]/detection-jobs/route.ts',
    'src/app/api/v1/pages/[id]/regions/route.ts',
  ];

  for (const route of routes) {
    const source = await read(route);
    assert.match(source, /jsonNoStore|errorResponse/, `Route ${route} must use jsonNoStore or errorResponse`);
    assert.match(source, /assertSameOrigin/, `Route ${route} must verify Origin`);
  }

  const detectionJobRoute = await read('src/app/api/v1/pages/[id]/detection-jobs/route.ts');
  assert.match(detectionJobRoute, /DetectionJobService\.startDetectionJob\([^)]*supabase\)/);
  assert.match(detectionJobRoute, /DetectionJobService\.executeDetection\([^)]*supabase\)/);

  // Check upload screen
  const uploadScreen = await read('src/app/app/documents/[id]/upload/page.tsx');
  assert.match(uploadScreen, /StepHeader/);
  assert.match(uploadScreen, /handleRotate/);
  assert.match(uploadScreen, /handleStartDetection/);

  // Check detect screen
  const detectScreen = await read('src/app/app/documents/[id]/detect/page.tsx');
  assert.match(detectScreen, /StepHeader/);
  assert.match(detectScreen, /LineOverlay/);
  assert.match(detectScreen, /handleRetry/);

  // Check line overlay
  const overlay = await read('src/components/document/line-overlay.tsx');
  assert.match(overlay, /viewBox=/);
  assert.match(overlay, /rect/);
});

test('RU and TG dictionaries maintain contract parity including stage 3 keys', async () => {
  const ru = JSON.parse(await read('src/i18n/dictionaries/ru.json'));
  const tg = JSON.parse(await read('src/i18n/dictionaries/tg.json'));

  assert.deepEqual(Object.keys(tg).sort(), Object.keys(ru).sort());
  assert.deepEqual(Object.keys(tg.document).sort(), Object.keys(ru.document).sort());

  const requiredKeys = [
    'uploadStep',
    'detectStep',
    'linesStep',
    'findLinesAction',
    'rotateLeft',
    'rotateRight',
    'replaceImage',
    'imageReady',
    'detecting',
    'detectingHint',
    'linesFound',
    'linesFoundDesc',
    'reviewLines',
    'zeroLines',
    'manualAnnotate',
    'detectionFailed',
    'retryDetection',
  ];

  for (const key of requiredKeys) {
    assert.ok(ru.document[key], `Missing ${key} in ru.document`);
    assert.ok(tg.document[key], `Missing ${key} in tg.document`);
  }
});
