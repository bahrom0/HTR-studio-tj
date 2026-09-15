import { Document, Packer, Paragraph, TextRun } from 'docx';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { defaultExportLayout, ExportLayoutItem, formatExportText, normalizeExportLayout } from '@/lib/export-layout';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { RecognitionJobService } from '@/server/recognition/service';
import { assertSameOrigin, errorResponse, HttpError } from '@/server/security/request';

export const runtime = 'nodejs';

function safeFilename(title: string, extension: 'txt' | 'docx') {
  const base = title
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 80) || 'tjocr-result';
  return `${base}.${extension}`;
}

function attachmentHeaders(filename: string, contentType: string) {
  return {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'private, no-store, max-age=0',
  };
}

const exportRequestSchema = z.object({
  format: z.enum(['txt', 'docx']),
  layout: z.array(z.object({
    index: z.number().int(),
    separatorBefore: z.enum(['none', 'line', 'paragraph']),
    indent: z.number().int(),
  })),
});

function appendTextRuns(runs: TextRun[], text: string, prefix = '') {
  for (const [index, piece] of text.split('\n').entries()) {
    if (index > 0) runs.push(new TextRun({ break: 1 }));
    if (piece || (index === 0 && prefix)) runs.push(new TextRun(`${index === 0 ? prefix : ''}${piece}`));
  }
}

function toDocument(lines: Array<{ text: string }>, layout: ExportLayoutItem[]) {
  const byIndex = new Map(layout.map((item) => [item.index, item]));
  const paragraphs: Paragraph[] = [];
  let runs: TextRun[] = [];
  for (const [index, line] of lines.entries()) {
    const item = byIndex.get(index);
    if (index > 0 && item?.separatorBefore === 'paragraph') {
      paragraphs.push(new Paragraph({ children: runs }));
      runs = [];
    } else if (index > 0 && item?.separatorBefore === 'line') {
      runs.push(new TextRun({ break: 1 }));
    } else if (index > 0 && item?.separatorBefore === 'none') {
      runs.push(new TextRun(' '));
    }
    if (line.text) appendTextRuns(runs, line.text, '    '.repeat(item?.indent ?? 0));
  }
  paragraphs.push(new Paragraph({ children: runs }));
  return new Document({ sections: [{ children: paragraphs }] });
}

async function createExportResponse(documentId: string, format: 'txt' | 'docx', layoutInput: unknown | null) {
  const supabase = await createServerSupabaseClient();
  const user = await requireUser(supabase);
  const { data: document, error: documentError } = await supabase
    .from('documents').select('id, title, owner_id').eq('id', documentId).eq('owner_id', user.id).is('deleted_at', null).single();
  if (documentError || !document) throw new HttpError('Документ не найден.', 'DOCUMENT_NOT_FOUND', 404, false);

  const results = await RecognitionJobService.getLineResults(documentId, user.id, supabase);
  const expectedIndexes = results.map((_, index) => index);
  const layout = layoutInput === null ? defaultExportLayout(expectedIndexes) : normalizeExportLayout(layoutInput, expectedIndexes);
  if (!layout || layout[0]?.separatorBefore !== 'none') throw new HttpError('Некорректный план отступов для экспорта.', 'INVALID_EXPORT_LAYOUT', 400, false);
  const lines = results.map((result, index) => ({ index, text: result.status === 'succeeded' ? (result.editedText ?? result.rawText) : '' }));
  const text = formatExportText(lines, layout);
  if (format === 'txt') {
    return new Response(`${text}\n`, { headers: attachmentHeaders(safeFilename(document.title, 'txt'), 'text/plain; charset=utf-8') });
  }
  const buffer = await Packer.toBuffer(toDocument(lines, layout));
  const body = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(body).set(buffer);
  return new Response(body, {
    headers: attachmentHeaders(safeFilename(document.title, 'docx'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: documentId } = await params;
    const format = request.nextUrl.searchParams.get('format');
    if (format !== 'txt' && format !== 'docx') {
      throw new HttpError('Укажите формат экспорта txt или docx.', 'INVALID_EXPORT_FORMAT', 400, false);
    }

    return await createExportResponse(documentId, format, null);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const { id: documentId } = await params;
    const parsed = exportRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new HttpError('Некорректные параметры экспорта.', 'INVALID_EXPORT_REQUEST', 400, false);
    return await createExportResponse(documentId, parsed.data.format, parsed.data.layout);
  } catch (error) {
    return errorResponse(error);
  }
}
