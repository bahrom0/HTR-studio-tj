import { TrOCRRuntime } from './runtime/trocr-runtime';
import type { CropInput, DetectedLine, LayoutAnalysisInput, LineDetectorInput, OCRHealth, OCRModelInfo, RecognizedLine } from './types';

/** Application boundary for every OCR request. Business services never select an inference implementation. */
export class OCRPipeline {
  constructor(private readonly runtime = new TrOCRRuntime()) {}

  initialize() { return this.runtime.initialize(); }
  assertConfiguration() { return this.runtime.assertConfiguration(); }
  recognize(image: CropInput, idempotencyKey?: string) { return this.runtime.recognize(image, idempotencyKey); }
  recognizeBatch(images: CropInput[], idempotencyKey?: string): Promise<RecognizedLine[]> { return this.runtime.recognizeBatch(images, idempotencyKey); }
  detectLines(image: LineDetectorInput): Promise<DetectedLine[]> { return this.runtime.detectLines(image); }
  analyseLayout(image: LayoutAnalysisInput): Promise<unknown> { return this.runtime.analyseLayout(image); }
  healthCheck(): Promise<OCRHealth> { return this.runtime.healthCheck(); }
  getModelInfo(): OCRModelInfo { return this.runtime.getModelInfo(); }
  getExecutionConfig() { return this.runtime.getExecutionConfig(); }
}

let pipeline: OCRPipeline | undefined;
export function getOCRPipeline(): OCRPipeline {
  pipeline ||= new OCRPipeline();
  return pipeline;
}
