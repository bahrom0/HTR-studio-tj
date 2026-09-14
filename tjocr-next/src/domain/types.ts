// Domain Types and Entities for TJOCR Next

export type DocumentState =
  | 'draft'
  | 'uploading'
  | 'uploaded'
  | 'detecting'
  | 'lines_ready'
  | 'recognizing'
  | 'completed'
  | 'failed';

export type JobKind = 'detection' | 'recognition' | 'test_step' | 'cleanup';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'cancelled'
  | 'succeeded'
  | 'partial'
  | 'failed';

export type AssetKind = 'source' | 'normalized' | 'crop' | 'export';

export interface DocumentDto {
  id: string;
  ownerId: string;
  title: string;
  state: DocumentState;
  expiresAt: string | null;
  bytes: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetDto {
  id: string;
  documentId: string;
  ownerId: string;
  objectKey: string;
  kind: AssetKind;
  mime: string;
  bytes: number;
  checksum: string;
  createdAt: string;
}

export interface JobDto {
  id: string;
  documentId: string;
  ownerId: string;
  kind: JobKind;
  status: JobStatus;
  completedCount: number;
  failedCount: number;
  totalCount: number;
  workflowId: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    messageKey: string;
    retryable: boolean;
  };
  requestId?: string;
}

export interface CreateDocumentResponse {
  document: DocumentDto;
  uploadUrl: string;
  objectKey: string;
  quota?: {
    plan: 'anonymous' | 'authenticated';
    usedDocuments: number;
    maxDocuments: number;
    usedBytes: number;
    maxBytes: number;
    windowDays: number;
    resetAt: string;
  };
}
