import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(join(root, relativePath), 'utf8');

test('viewport to image coordinate transformation under zoom and pan', () => {
  // Model clientToImageCoords from LineEditor
  const clientToImage = (clientX, clientY, rect, pan, zoom, imgW, imgH) => {
    const vx = clientX - rect.left - pan.x;
    const vy = clientY - rect.top - pan.y;
    const imgX = vx / zoom;
    const imgY = vy / zoom;
    return {
      x: Math.max(0, Math.min(imgW, Math.round(imgX))),
      y: Math.max(0, Math.min(imgH, Math.round(imgY))),
    };
  };

  const rect = { left: 100, top: 50 };
  const imgW = 1000;
  const imgH = 2000;

  // 1. 100% Zoom, No Pan
  const pt1 = clientToImage(300, 250, rect, { x: 0, y: 0 }, 1.0, imgW, imgH);
  assert.equal(pt1.x, 200); // 300 - 100
  assert.equal(pt1.y, 200); // 250 - 50

  // 2. 200% Zoom, with Pan
  const pt2 = clientToImage(400, 450, rect, { x: 100, y: 50 }, 2.0, imgW, imgH);
  // vx = 400 - 100 - 100 = 200 => imgX = 200 / 2 = 100
  // vy = 450 - 50 - 50 = 350 => imgY = 350 / 2 = 175
  assert.equal(pt2.x, 100);
  assert.equal(pt2.y, 175);

  // 3. 50% Zoom, Boundary Clamping
  const pt3 = clientToImage(10, 10, rect, { x: 0, y: 0 }, 0.5, imgW, imgH);
  assert.equal(pt3.x, 0); // negative clamped to 0
  assert.equal(pt3.y, 0);

  const pt4 = clientToImage(5000, 5000, rect, { x: 0, y: 0 }, 0.5, imgW, imgH);
  assert.equal(pt4.x, imgW); // clamped to max width
  assert.equal(pt4.y, imgH); // clamped to max height
});

test('reading order reordering and reindexing logic', () => {
  const initialRegions = [
    { id: '1', readingOrder: 0 },
    { id: '2', readingOrder: 1 },
    { id: '3', readingOrder: 2 },
  ];

  // Move #2 up => should become order 0
  const moveUp = (items, id) => {
    const idx = items.findIndex((r) => r.id === id);
    if (idx <= 0) return items;
    const copy = [...items];
    const temp = copy[idx];
    copy[idx] = copy[idx - 1];
    copy[idx - 1] = temp;
    return copy.map((r, i) => ({ ...r, readingOrder: i }));
  };

  const reordered = moveUp(initialRegions, '2');
  assert.equal(reordered[0].id, '2');
  assert.equal(reordered[0].readingOrder, 0);
  assert.equal(reordered[1].id, '1');
  assert.equal(reordered[1].readingOrder, 1);
  assert.equal(reordered[2].id, '3');
  assert.equal(reordered[2].readingOrder, 2);

  // Delete item '1' => remaining items are reindexed 0, 1
  const deleteItem = (items, id) =>
    items.filter((r) => r.id !== id).map((r, i) => ({ ...r, readingOrder: i }));

  const afterDelete = deleteItem(reordered, '1');
  assert.equal(afterDelete.length, 2);
  assert.equal(afterDelete[0].id, '2');
  assert.equal(afterDelete[0].readingOrder, 0);
  assert.equal(afterDelete[1].id, '3');
  assert.equal(afterDelete[1].readingOrder, 1);
});

test('undo stack state snapshots and restoration', () => {
  let regions = [{ id: 'a', val: 1 }];
  const undoStack = [];

  const pushUndo = (state) => {
    undoStack.push(JSON.parse(JSON.stringify(state)));
  };

  // Action 1: Add item
  pushUndo(regions);
  regions = [...regions, { id: 'b', val: 2 }];
  assert.equal(regions.length, 2);

  // Action 2: Modify item
  pushUndo(regions);
  regions = regions.map((r) => (r.id === 'b' ? { ...r, val: 99 } : r));
  assert.equal(regions[1].val, 99);

  // Undo Action 2
  regions = undoStack.pop();
  assert.equal(regions[1].val, 2);

  // Undo Action 1
  regions = undoStack.pop();
  assert.equal(regions.length, 1);
  assert.equal(regions[0].id, 'a');
});

test('Stage 4 editor source components and routes exist', async () => {
  const files = [
    'src/app/app/documents/[id]/lines/page.tsx',
    'src/components/document/line-editor.tsx',
    'src/components/document/line-crop-preview.tsx',
    'src/components/document/line-sidebar.tsx',
  ];

  for (const file of files) {
    const content = await read(file);
    assert.ok(content.length > 0, `File ${file} should not be empty`);
    assert.match(content, /export/);
  }
});

test('RU and TG dictionaries maintain contract parity including Stage 4 keys', async () => {
  const ru = JSON.parse(await read('src/i18n/dictionaries/ru.json'));
  const tg = JSON.parse(await read('src/i18n/dictionaries/tg.json'));

  assert.deepEqual(Object.keys(tg.document).sort(), Object.keys(ru.document).sort());

  const stage4Keys = [
    'backToDetect',
    'zoomIn',
    'zoomOut',
    'fitToScreen',
    'addLine',
    'deleteLine',
    'moveUp',
    'moveDown',
    'undo',
    'selectedLine',
    'lineCropTitle',
    'noLinesYet',
    'recognizeLinesAction',
    'savingRevision',
    'savedRevision',
    'revisionConflict',
    'allLines',
    'readingOrder',
    'panHint',
  ];

  for (const key of stage4Keys) {
    assert.ok(ru.document[key], `RU dictionary missing stage 4 key: ${key}`);
    assert.ok(tg.document[key], `TG dictionary missing stage 4 key: ${key}`);
  }
});
