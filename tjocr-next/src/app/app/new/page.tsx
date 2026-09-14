'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useRef, useState } from 'react';
import { useLocale } from '@/components/app-shell';
import FileUpload05, { type FileUploadState } from '@/components/block/FileUpload/fileupload-05/fileupload';

type CreateDocumentResponse = {
  document: { id: string };
  uploadUrl: string;
  objectKey: string;
};

const UPLOAD_VISUAL_CAP = 98;
const PROGRESS_TICK_MS = 80;
const PROGRESS_FRAME_MS = 160;

function waitForProgressFrame(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function uploadToSignedUrl(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
  signal: AbortSignal
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let actualProgress = 0;
    let displayedProgress = 0;
    let progressTimer: number | null = null;
    const startedAt = performance.now();

    const emitProgress = (percent: number) => {
      const nextProgress = Math.min(UPLOAD_VISUAL_CAP, Math.max(displayedProgress, percent));
      if (nextProgress === displayedProgress && displayedProgress !== 0) return;
      displayedProgress = nextProgress;
      onProgress(nextProgress);
    };

    const tickProgress = () => {
      if (settled) return;

      // XHR remains the source of truth when it emits byte counts. The time
      // curve only fills gaps between sparse events and never passes 96%.
      const elapsedProgress = Math.min(96, ((performance.now() - startedAt) / 1800) * 96);
      const byteProgress = Math.min(96, actualProgress * 0.96);
      const targetProgress = Math.max(elapsedProgress, byteProgress);
      const easedProgress = displayedProgress + Math.max(0.35, (targetProgress - displayedProgress) * 0.16);
      emitProgress(Math.min(96, easedProgress));
      progressTimer = window.setTimeout(tickProgress, PROGRESS_TICK_MS);
    };

    const handleProgress = (event: ProgressEvent<XMLHttpRequestEventTarget>) => {
      if (event.lengthComputable && event.total > 0) {
        actualProgress = (event.loaded / event.total) * 100;
      }
    };

    const cleanup = () => {
      signal.removeEventListener('abort', handleAbort);
      xhr.upload.removeEventListener('progress', handleProgress);
      if (progressTimer !== null) {
        window.clearTimeout(progressTimer);
        progressTimer = null;
      }
    };

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const handleAbort = () => {
      xhr.abort();
      finish(() => reject(new DOMException('Upload aborted', 'AbortError')));
    };

    xhr.upload.addEventListener('progress', handleProgress);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // 98% means the bytes reached Storage. The caller moves to 99% only
        // while the server verifies the object and writes the DB records.
        emitProgress(UPLOAD_VISUAL_CAP);
        finish(resolve);
      } else {
        finish(() => reject(new Error(`Storage upload failed: HTTP ${xhr.status}`)));
      }
    };
    xhr.onerror = () => finish(() => reject(new Error('Storage upload failed')));
    xhr.onabort = () => finish(() => reject(new DOMException('Upload aborted', 'AbortError')));
    signal.addEventListener('abort', handleAbort, { once: true });

    if (signal.aborted) {
      handleAbort();
      return;
    }

    emitProgress(0);
    progressTimer = window.setTimeout(tickProgress, PROGRESS_TICK_MS);

    try {
      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.send(file);
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error('Storage upload failed')));
    }
  });
}

export default function NewDocumentPage() {
  const { dictionary: t } = useLocale();
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadState, setUploadState] = useState<FileUploadState>('idle');
  const uploadControllerRef = useRef<AbortController | null>(null);

  const handleFilesChange = async (nextFiles: File[]) => {
    uploadControllerRef.current?.abort();
    setFiles(nextFiles);

    const file = nextFiles[0];
    if (!file) {
      setUploadProgress(null);
      setUploadState('idle');
      return;
    }

    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setUploadProgress(0);
    setUploadState('preparing');

    try {
      const authResponse = await fetch('/api/v1/auth/anonymous', {
        method: 'POST',
        signal: controller.signal,
      });
      if (!authResponse.ok) throw new Error('Anonymous session failed');

      const createResponse = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: file.name, bytes: file.size }),
        signal: controller.signal,
      });
      const createData = (await createResponse.json().catch(() => null)) as CreateDocumentResponse | null;
      if (!createResponse.ok || !createData?.uploadUrl || !createData.document?.id) {
        throw new Error('Document reservation failed');
      }

      setUploadState('uploading');
      await uploadToSignedUrl(createData.uploadUrl, file, (percent) => setUploadProgress(percent), controller.signal);

      // Give the 98% transfer state a paint before verification takes over.
      await waitForProgressFrame(PROGRESS_FRAME_MS);
      setUploadProgress(99);
      setUploadState('verifying');
      const completeRequest = fetch(`/api/v1/documents/${createData.document.id}/upload-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectKey: createData.objectKey,
          mime: file.type,
          bytes: file.size,
        }),
        signal: controller.signal,
      });
      const [completeResponse] = await Promise.all([completeRequest, waitForProgressFrame(PROGRESS_FRAME_MS)]);
      if (!completeResponse.ok) throw new Error('Upload confirmation failed');

      setUploadProgress(100);
      setUploadState('complete');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('[TJOCR upload]', error);
      setUploadState('error');
    } finally {
      if (uploadControllerRef.current === controller) uploadControllerRef.current = null;
    }
  };

  const handleFileRemove = () => {
    uploadControllerRef.current?.abort();
  };

  const statusLabel =
    uploadState === 'preparing'
      ? t.newDocument.statusPreparing
      : uploadState === 'uploading'
        ? t.newDocument.statusUploading
        : uploadState === 'verifying'
          ? t.newDocument.statusVerifying
          : uploadState === 'complete'
            ? t.newDocument.statusComplete
            : uploadState === 'error'
              ? t.newDocument.statusError
              : undefined;

  return (
    <div className="workspace-page">
      <section className="next-screen page-width" aria-labelledby="new-document-title">
        <Link className="text-action text-action--back" href="/app">
          <ArrowLeft aria-hidden="true" size={15} />
          {t.newDocument.back}
        </Link>
        <h1 id="new-document-title">{t.newDocument.title}</h1>
        <p className="workspace-description">{t.newDocument.description}</p>
        <FileUpload05
          value={files}
          onChange={handleFilesChange}
          onRemove={handleFileRemove}
          maxFiles={1}
          maxSize={10 * 1024 * 1024}
          accept={{
            'image/jpeg': ['.jpg', '.jpeg'],
            'image/png': ['.png'],
            'image/webp': ['.webp'],
          }}
          title={t.newDocument.uploadTitle}
          description={t.newDocument.uploadDescription}
          actionLabel={t.newDocument.choose}
          hint={t.newDocument.uploadHint}
          activeLabel={t.newDocument.dropActive}
          removeLabel={t.newDocument.remove}
          progress={files.length > 0 ? uploadProgress : null}
          uploadState={uploadState}
          statusLabel={files.length > 0 ? statusLabel : undefined}
          errorMessage={uploadState === 'error' ? t.newDocument.uploadError : undefined}
        />
      </section>
    </div>
  );
}
