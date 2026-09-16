import { LocalInferenceAdapter } from '../adapters/local-inference-adapter';
import { getOCRRuntimeConfig } from '../config';
import { createTrOCRModelInfo } from '../model';
import { ImagePreprocessor } from '../preprocessing';
import type { CropInput, DetectedLine, LayoutAnalysisInput, LineDetectorInput, OCRHealth, OCRModelInfo, OCRRuntimeConfig, OCRRuntimeState, RecognizedLine } from '../types';

export class TrOCRRuntime {
  private readonly config: OCRRuntimeConfig;
  private readonly adapter: LocalInferenceAdapter;
  private readonly preprocessor = new ImagePreprocessor();
  private state: OCRRuntimeState = 'idle';
  private initialization?: Promise<void>;

  constructor(config = getOCRRuntimeConfig()) {
    this.config = config;
    this.adapter = new LocalInferenceAdapter(config);
  }

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.state = 'initializing';
      this.initialization = Promise.resolve().then(() => this.adapter.assertConfigured()).then(
        () => { this.state = 'ready'; },
        (error) => { this.state = 'unavailable'; this.initialization = undefined; throw error; },
      );
    }
    return this.initialization;
  }

  assertConfiguration(): void {
    this.adapter.assertConfigured();
  }

  async recognize(image: CropInput, idempotencyKey?: string): Promise<RecognizedLine> {
    const [result] = await this.recognizeBatch([image], idempotencyKey);
    return result;
  }

  async recognizeBatch(images: CropInput[], idempotencyKey?: string): Promise<RecognizedLine[]> {
    await this.initialize();
    return this.adapter.recognizeBatch(images.map((image) => this.preprocessor.prepareCrop(image)), idempotencyKey);
  }

  async detectLines(image: LineDetectorInput): Promise<DetectedLine[]> {
    await this.initialize();
    return this.adapter.detectLines(this.preprocessor.preparePage(image));
  }

  async analyseLayout(image: LayoutAnalysisInput): Promise<unknown> {
    await this.initialize();
    return this.adapter.analyseLayout(this.preprocessor.preparePage(image));
  }

  async healthCheck(): Promise<OCRHealth> {
    try {
      await this.initialize();
      return { status: 'ready', model: this.getModelInfo() };
    } catch {
      return { status: 'unavailable', model: this.getModelInfo('unavailable') };
    }
  }

  getModelInfo(status: OCRModelInfo['status'] = this.state === 'unavailable' ? 'unavailable' : 'ready'): OCRModelInfo {
    return createTrOCRModelInfo(status, this.config.device);
  }

  getExecutionConfig() {
    return { batchSize: this.config.batchSize, batchConcurrency: this.config.batchConcurrency };
  }
}
