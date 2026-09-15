import { Document, Packer, Paragraph, TextRun } from 'docx';
import { NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/server/supabase/server';
import { requireUser } from '@/server/auth/session';
import { RecognitionJobService } from '@/server/recognition/service';
import { errorResponse, HttpError } from '@/server/security/request';

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

    const supabase = await createServerSupabaseClient();
    const user = await requireUser(supabase);
    const { data: document, error: documentError } = await supabase
      .from('documents')
      .select('id, title, owner_id')
      .eq('id', documentId)
      .eq('owner_id', user.id)
      .is('deleted_at', null)
      .single();

    if (documentError || !document) {
      throw new HttpError('Документ не найден.', 'DOCUMENT_NOT_FOUND', 404, false);
    }

    const results = await RecognitionJobService.getLineResults(documentId, user.id, supabase);
    const lines = results.map((result) => result.status === 'succeeded'
      ? (result.editedText ?? result.rawText)
      : '');

    if (format === 'txt') {
      return new Response(`${lines.join('\n')}\n`, {
        headers: attachmentHeaders(safeFilename(document.title, 'txt'), 'text/plain; charset=utf-8'),
      });
    }

    const file = new Document({
      sections: [{
        children: lines.map((line) => new Paragraph({
          children: line ? [new TextRun(line)] : [],
        })),
      }],
    });
    const buffer = await Packer.toBuffer(file);
    const body = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(body).set(buffer);
    return new Response(body, {
      headers: attachmentHeaders(
        safeFilename(document.title, 'docx'),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
