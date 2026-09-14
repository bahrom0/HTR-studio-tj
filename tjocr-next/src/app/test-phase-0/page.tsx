'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Status } from '@/components/ui/status';
import { Shield, UploadCloud, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function Phase0TestPage() {
  // Step 1: Session state
  const [userId, setUserId] = useState<string | null>(null);
  const [isAnonymous, setIsAnonymous] = useState<boolean>(false);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // Step 2: Upload state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Step 3 & 4: Job state
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string | null>(null);
  const [jobLoading, setJobLoading] = useState(false);
  const [jobError, setJobError] = useState<string | null>(null);
  const [isSimulatedFailure, setIsSimulatedFailure] = useState(false);

  // 1. Authenticate anonymously
  const handleAuth = async () => {
    setSessionLoading(true);
    setSessionError(null);
    try {
      const res = await fetch('/api/v1/auth/anonymous', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.messageKey || data.error?.code || 'Ошибка авторизации');
      setUserId(data.user.id);
      setIsAnonymous(data.user.isAnonymous);
    } catch (err: any) {
      setSessionError(err.message);
    } finally {
      setSessionLoading(false);
    }
  };

  // 2. Direct upload > 4.5 MB
  const handleDirectUpload = async () => {
    if (!selectedFile) return;
    setUploadLoading(true);
    setUploadError(null);
    setUploadProgress('Резервирование адреса в хранилище...');

    try {
      // Step A: Request signed upload URL from backend
      const createRes = await fetch('/api/v1/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: selectedFile.name }),
      });
      const createData = await createRes.json();
      if (!createRes.ok) throw new Error(createData.error?.code || 'Не удалось зарезервировать документ');

      const docId = createData.document.id;
      const signedUrl = createData.uploadUrl;
      const objectKey = createData.objectKey;
      setDocumentId(docId);

      // Step B: Upload file directly to Supabase Storage via signed URL (bypassing Vercel 4.5MB limit)
      setUploadProgress(`Отправка ${(selectedFile.size / (1024 * 1024)).toFixed(2)} МБ напрямую в Supabase Storage...`);
      const storageRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': selectedFile.type || 'application/octet-stream',
        },
        body: selectedFile,
      });

      if (!storageRes.ok) {
        throw new Error(`Сбой прямой загрузки в Storage: HTTP ${storageRes.status}`);
      }

      // Step C: Confirm completion on server
      setUploadProgress('Верификация объекта сервером...');
      const completeRes = await fetch(`/api/v1/documents/${docId}/upload-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectKey,
          mime: selectedFile.type,
          bytes: selectedFile.size,
        }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok) throw new Error(completeData.error?.messageKey || completeData.error?.code || 'Не удалось подтвердить загрузку');

      setUploadProgress(`Файл успешно подтвержден в хранилище (${(completeData.bytes / (1024 * 1024)).toFixed(2)} МБ).`);
    } catch (err: any) {
      setUploadError(err.message);
      setUploadProgress(null);
    } finally {
      setUploadLoading(false);
    }
  };

  // 3. Execute Step (Normal or Simulated Failure)
  const handleExecuteStep = async (simulateFailure: boolean) => {
    if (!documentId) return;
    setJobLoading(true);
    setJobError(null);
    setIsSimulatedFailure(simulateFailure);

    try {
      const res = await fetch('/api/v1/jobs/test-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, simulateFailure }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.messageKey || data.error?.code || 'Ошибка шага');

      setJobId(data.job.id);
      setJobStatus(data.job.status);
      if (data.job.status === 'failed') {
        setJobError(`Сбой шага: ${data.job.errorCode || 'FAILED'}`);
      }
    } catch (err: any) {
      setJobError(err.message);
    } finally {
      setJobLoading(false);
    }
  };

  // 4. Retry failed job (Durable Recovery)
  const handleRetryJob = async () => {
    if (!jobId) return;
    setJobLoading(true);
    setJobError(null);

    try {
      const res = await fetch(`/api/v1/jobs/${jobId}/retry`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.messageKey || data.error?.code || 'Ошибка повтора');

      setJobStatus(data.job.status);
      setIsSimulatedFailure(false);
    } catch (err: any) {
      setJobError(err.message);
    } finally {
      setJobLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 w-full flex flex-col gap-8">
      <div>
        <div className="text-xs font-mono uppercase tracking-wider text-app-text-secondary mb-1">
          Верификационная панель
        </div>
        <h1 className="text-2xl font-medium text-app-text">
          Этап 0: Изоляция и техническая основа
        </h1>
        <p className="text-sm text-app-text-secondary mt-1">
          Проверка анонимной сессии, прямой загрузки файла &gt; 4.5 МБ в Supabase Storage и надежного шага (Durable Step).
        </p>
      </div>

      {/* Step 1: Anonymous Auth */}
      <section className="p-6 border border-border rounded-panel bg-surface flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded border border-border bg-background flex items-center justify-center">
            <Shield className="w-4 h-4 text-app-text" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-app-text">1. Анонимная сессия Supabase Auth</h2>
            <p className="text-xs text-app-text-secondary">Создание изолированного UID без пароля с ролью authenticated.</p>
          </div>
        </div>

        {userId ? (
          <div className="flex flex-col gap-2 bg-background p-3 rounded border border-border text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="text-app-text-secondary">User ID:</span>
              <span className="text-app-text">{userId}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-app-text-secondary">Режим:</span>
              <span className="text-status-success">{isAnonymous ? 'Анонимный гость' : 'Зарегистрированный'}</span>
            </div>
          </div>
        ) : (
          <Button onClick={handleAuth} isLoading={sessionLoading} className="self-start">
            Создать гостевую сессию
          </Button>
        )}

        {sessionError && (
          <Status variant="danger">Ошибка авторизации: {sessionError}</Status>
        )}
      </section>

      {/* Step 2: Direct Upload > 4.5 MB */}
      <section className="p-6 border border-border rounded-panel bg-surface flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded border border-border bg-background flex items-center justify-center">
            <UploadCloud className="w-4 h-4 text-app-text" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-app-text">2. Прямая загрузка файла (&gt; 4.5 МБ)</h2>
            <p className="text-xs text-app-text-secondary">
              Загрузка напрямую в приватный бакет через Signed URL в обход лимита Vercel Functions (4.5 МБ).
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={!userId || uploadLoading}
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            className="text-xs text-app-text-secondary file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:text-xs file:font-medium file:bg-background file:text-app-text file:cursor-pointer border border-border rounded p-1 w-full sm:w-auto"
          />
          <Button
            onClick={handleDirectUpload}
            disabled={!userId || !selectedFile || uploadLoading}
            isLoading={uploadLoading}
          >
            Загрузить напрямую
          </Button>
        </div>

        {selectedFile && (
          <div className="text-xs text-app-text-secondary">
            Выбран файл: <span className="font-mono text-app-text">{selectedFile.name}</span> ({(selectedFile.size / (1024 * 1024)).toFixed(2)} МБ)
            {selectedFile.size > 4.5 * 1024 * 1024 ? (
              <span className="text-status-success ml-2">✓ Размер &gt; 4.5 МБ (проверяет обход лимита Vercel)</span>
            ) : (
              <span className="text-app-text-secondary ml-2">(Для полного теста рекомендуется файл &gt; 4.5 МБ)</span>
            )}
          </div>
        )}

        {uploadProgress && (
          <Status variant="loading">{uploadProgress}</Status>
        )}

        {documentId && (
          <div className="bg-background p-3 rounded border border-border text-xs font-mono flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-status-success" />
            <span>Документ сохранен: {documentId}</span>
          </div>
        )}

        {uploadError && (
          <Status variant="danger">Ошибка загрузки: {uploadError}</Status>
        )}
      </section>

      {/* Step 3: Durable Job & Step Recovery */}
      <section className="p-6 border border-border rounded-panel bg-surface flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded border border-border bg-background flex items-center justify-center">
            <RefreshCw className="w-4 h-4 text-app-text" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-app-text">3. Сохраненная задача и надежный шаг</h2>
            <p className="text-xs text-app-text-secondary">
              Запись в jobs и outbox, симуляция сбоя и проверка восстановления (Retry/Recovery).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            onClick={() => handleExecuteStep(false)}
            disabled={!documentId || jobLoading}
            isLoading={jobLoading && !isSimulatedFailure}
          >
            Запустить нормальный шаг
          </Button>

          <Button
            variant="outline"
            onClick={() => handleExecuteStep(true)}
            disabled={!documentId || jobLoading}
            isLoading={jobLoading && isSimulatedFailure}
          >
            <AlertTriangle className="w-3.5 h-3.5 mr-1.5 text-status-danger" />
            Симулировать сбой шага
          </Button>

          {jobStatus === 'failed' && (
            <Button
              variant="secondary"
              onClick={handleRetryJob}
              isLoading={jobLoading}
            >
              Восстановить задачу (Retry)
            </Button>
          )}
        </div>

        {jobId && (
          <div className="bg-background p-3 rounded border border-border text-xs font-mono flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-app-text-secondary">Job ID:</span>
              <span className="text-app-text">{jobId}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-app-text-secondary">Статус:</span>
              <span className={jobStatus === 'succeeded' ? 'text-status-success' : jobStatus === 'failed' ? 'text-status-danger' : 'text-app-text'}>
                {jobStatus}
              </span>
            </div>
          </div>
        )}

        {jobError && (
          <Status variant="danger">{jobError}</Status>
        )}
      </section>
    </div>
  );
}
