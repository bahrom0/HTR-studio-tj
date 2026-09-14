'use client';

import * as React from 'react';
import { useDropzone, type Accept } from 'react-dropzone';
import { ImagePlus, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type FileUploadState = 'idle' | 'preparing' | 'uploading' | 'verifying' | 'complete' | 'error';

export interface FileUploadProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  onChange?: (files: File[]) => void;
  onRemove?: (file: File) => void;
  value?: File[];
  maxFiles?: number;
  maxSize?: number;
  accept?: Accept;
  title: string;
  description: string;
  actionLabel: string;
  hint?: string;
  activeLabel: string;
  removeLabel: string;
  progress?: number | null;
  uploadState?: FileUploadState;
  statusLabel?: string;
  errorMessage?: string;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKey(file: File) {
  return `${file.name}-${file.lastModified}`;
}

export default function FileUpload05({
  onChange,
  onRemove,
  value = [],
  maxFiles = 1,
  maxSize = 10 * 1024 * 1024,
  accept,
  title,
  description,
  actionLabel,
  hint,
  activeLabel,
  removeLabel,
  progress = null,
  uploadState = 'idle',
  statusLabel,
  errorMessage,
  className,
  ...props
}: FileUploadProps) {
  const [files, setFiles] = React.useState<File[]>(value);
  const [removingKey, setRemovingKey] = React.useState<string | null>(null);
  const removeTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setFiles(value);
  }, [value]);

  React.useEffect(
    () => () => {
      if (removeTimerRef.current !== null) window.clearTimeout(removeTimerRef.current);
    },
    []
  );

  const handleDrop = React.useCallback(
    (acceptedFiles: File[]) => {
      const nextFiles = maxFiles === 1 ? acceptedFiles.slice(0, 1) : [...files, ...acceptedFiles].slice(0, maxFiles);
      setFiles(nextFiles);
      onChange?.(nextFiles);
    },
    [files, maxFiles, onChange]
  );

  const handleRemove = (file: File) => {
    const key = fileKey(file);
    if (removingKey) return;
    setRemovingKey(key);
    onRemove?.(file);
    removeTimerRef.current = window.setTimeout(() => {
      const nextFiles = files.filter((currentFile) => currentFile !== file);
      setFiles(nextFiles);
      setRemovingKey(null);
      onChange?.(nextFiles);
      removeTimerRef.current = null;
    }, 180);
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept,
    maxFiles,
    maxSize,
    noClick: true,
    onDrop: handleDrop,
  });

  const progressValue = typeof progress === 'number' ? Math.max(0, Math.min(100, Math.round(progress))) : 0;
  const removeStyle = { '--upload-progress': `${progressValue}%` } as React.CSSProperties;

  return (
    <div className={cn('file-upload', className)} {...props}>
      <div
        {...getRootProps({
          className: cn('file-upload__dropzone', isDragActive && 'file-upload__dropzone--active'),
          'aria-label': title,
          'aria-busy': uploadState === 'preparing' || uploadState === 'uploading' || uploadState === 'verifying',
        })}
      >
        <input {...getInputProps()} />
        <div className="file-upload__content">
          <div className="file-upload__icon" aria-hidden="true">
            <ImagePlus size={22} strokeWidth={1.7} />
          </div>
          <div className="file-upload__copy">
            <p className="file-upload__title">{title}</p>
            <p className="file-upload__description">{description}</p>
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
            className="file-upload__action"
            onClick={(event) => {
              event.stopPropagation();
              open();
            }}
          >
            <Upload aria-hidden="true" size={16} />
            {actionLabel}
          </Button>
          {hint ? <p className="file-upload__hint">{hint}</p> : null}
        </div>
        {isDragActive ? (
          <div className="file-upload__overlay" aria-live="polite">
            <span>{activeLabel}</span>
          </div>
        ) : null}
      </div>

      <div
        className={cn('file-upload__files-shell', files.length > 0 && 'file-upload__files-shell--open')}
        aria-hidden={files.length === 0}
      >
        {files.length > 0 ? (
          <ul className="file-upload__files" aria-label={title}>
            {files.map((file) => {
              const key = fileKey(file);
              const isRemoving = removingKey === key;
              const isComplete = uploadState === 'complete';
              const isError = uploadState === 'error';

              return (
                <li className={cn('file-upload__file', isRemoving && 'file-upload__file--removing')} key={key}>
                  <div className="file-upload__file-copy">
                    <span className="file-upload__file-name">{file.name}</span>
                    <span className="file-upload__file-meta">
                      {formatFileSize(file.size)}
                      {progress !== null ? <span className="file-upload__file-progress"> · {progressValue}%</span> : null}
                    </span>
                    {statusLabel ? (
                      <span className={cn('file-upload__status', isComplete && 'file-upload__status--complete', isError && 'file-upload__status--error')} aria-live="polite">
                        {statusLabel}
                      </span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={cn('file-upload__remove', isComplete && 'file-upload__remove--complete', isError && 'file-upload__remove--error')}
                    style={removeStyle}
                    aria-label={`${removeLabel}: ${file.name}`}
                    onClick={() => handleRemove(file)}
                  >
                    <X aria-hidden="true" size={16} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {errorMessage ? (
        <p className="file-upload__error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
