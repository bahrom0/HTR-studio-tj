import { HttpError } from '@/server/security/request';
import type { CropInput, LineDetectorInput, LayoutAnalysisInput } from './types';

/** Validates image hand-off without changing the pixel data used by the current model path. */
export class ImagePreprocessor {
  prepareCrop(input: CropInput): CropInput {
    if (!input.imageBuffer?.length) throw new HttpError('Recognition request failed.', 'OCR_IMAGE_MISSING', 400, false);
    return input;
  }

  preparePage<T extends LineDetectorInput | LayoutAnalysisInput>(input: T): T {
    if (!input.imageBuffer?.length) throw new HttpError('Recognition request failed.', 'OCR_IMAGE_MISSING', 400, false);
    return input;
  }
}
