import { getOCRPipeline } from '@/ocr';
import { jsonNoStore } from '@/server/security/request';

/** Abstraction-only runtime status. It is safe to expose to the application. */
export async function GET() {
  const health = await getOCRPipeline().healthCheck();
  return jsonNoStore(health, { status: health.status === 'ready' ? 200 : 503 });
}
