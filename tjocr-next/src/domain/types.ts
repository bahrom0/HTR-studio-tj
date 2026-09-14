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

export interface RegionGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  polygon?: Array<{ x: number; y: number }>;
}

export interface RegionDto {
  id: string;
  revisionId: string;
  readingOrder: number;
  geometry: RegionGeometry;
  excluded: boolean;
  createdAt: string;
}

export interface RegionRevisionDto {
  id: string;
  pageId: string;
  revisionNumber: number;
  imageRevision: number;
  confirmedAt: string | null;
  createdAt: string;
  regions: RegionDto[];
}

export interface PageDto {
  id: string;
  documentId: string;
  sourceAssetId: string | null;
  normalizedAssetId: string | null;
  width: number;
  height: number;
  imageRevision: number;
  createdAt: string;
}

export interface LineResultDto {
  id: string;
  jobId: string;
  regionId: string;
  cropAssetId: string | null;
  attempt: number;
  rawText: string;
  status: 'succeeded' | 'failed';
  createdAt: string;
  readingOrder?: number;
  geometry?: RegionGeometry;
  editedText?: string;
}

export interface RecognitionJobResponse {
  job: JobDto;
  alreadyRunning: boolean;
}

