import { z } from 'zod';

const envSchema = z.object({
  // Supabase public
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

  // Supabase server secret
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default('htr-uploads'),

  // Upload and retention guardrails. Quota values are enforced again in the
  // database migration; these values protect the HTTP boundary before a
  // request reaches Storage.
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  ANONYMOUS_DOCUMENT_TTL_DAYS: z.coerce.number().int().positive().default(7),
  AUTHENTICATED_DOCUMENT_TTL_DAYS: z.coerce.number().int().min(0).default(0),
  AUTH_PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).max(128).default(8),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(8),
  ANONYMOUS_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  DOCUMENT_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(20),
  CRON_SECRET: z.string().min(16).optional(),

  // External OCR & Line Detection (Neutral names, server-only)
  OCR_API_BASE_URL: z.string().url().optional(),
  OCR_API_KEY: z.string().min(1).optional(),
  OCR_MODEL_ID: z.string().min(1).optional(),
  DETECTOR_MODEL_ID: z.string().min(1).optional(),
  RECOGNIZER_MODEL_ID: z.string().min(1).optional(),
  RECOGNITION_BATCH_SIZE: z.coerce.number().int().min(1).max(16).default(4),
  RECOGNITION_BATCH_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(2),
  OCR_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(60_000).default(20_000),
  OCR_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(128).max(4_096).default(1_024),
  OCR_REASONING_EFFORT: z.enum(['low', 'medium', 'high']).default('low'),
  OPENROUTER_OCR_PROVIDER: z.string().min(1).default('google-ai-studio/flex'),
  OPENROUTER_PREFERRED_MAX_LATENCY_SECONDS: z.coerce.number().min(0.5).max(60).default(5),
  OPENROUTER_PREFERRED_MIN_THROUGHPUT: z.coerce.number().int().min(1).max(1_000).default(60),

  // App settings
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = z.infer<typeof envSchema>;

let parsedConfig: AppConfig | null = null;

function resolveAppUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  const port = process.env.PORT;
  if (port && (!envUrl || envUrl.includes('localhost:3000') || envUrl.includes('127.0.0.1:3000'))) {
    return `http://localhost:${port}`;
  }
  return envUrl || (port ? `http://localhost:${port}` : 'http://localhost:3000');
}

export function getServerConfig(): AppConfig {
  if (parsedConfig) {
    return parsedConfig;
  }

  const result = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_STORAGE_BUCKET: process.env.SUPABASE_STORAGE_BUCKET || process.env.SUPABASE_BUCKET || 'htr-uploads',
    MAX_UPLOAD_BYTES: process.env.MAX_UPLOAD_BYTES || 10 * 1024 * 1024,
    ANONYMOUS_DOCUMENT_TTL_DAYS: process.env.ANONYMOUS_DOCUMENT_TTL_DAYS || 7,
    AUTHENTICATED_DOCUMENT_TTL_DAYS: process.env.AUTHENTICATED_DOCUMENT_TTL_DAYS || 0,
    AUTH_PASSWORD_MIN_LENGTH: process.env.AUTH_PASSWORD_MIN_LENGTH || 8,
    AUTH_RATE_LIMIT_PER_MINUTE: process.env.AUTH_RATE_LIMIT_PER_MINUTE || 8,
    ANONYMOUS_RATE_LIMIT_PER_MINUTE: process.env.ANONYMOUS_RATE_LIMIT_PER_MINUTE || 20,
    DOCUMENT_RATE_LIMIT_PER_MINUTE: process.env.DOCUMENT_RATE_LIMIT_PER_MINUTE || 20,
    CRON_SECRET: process.env.CRON_SECRET,
    OCR_API_BASE_URL: process.env.OCR_API_BASE_URL || 'https://openrouter.ai/api/v1',
    OCR_API_KEY: process.env.OCR_API_KEY || process.env.OPENROUTER_API_KEY,
    OCR_MODEL_ID: process.env.OCR_MODEL_ID || process.env.HTR_OCR_MODEL,
    DETECTOR_MODEL_ID: process.env.DETECTOR_MODEL_ID,
    RECOGNIZER_MODEL_ID: process.env.RECOGNIZER_MODEL_ID || process.env.OCR_MODEL_ID || process.env.HTR_OCR_MODEL,
    RECOGNITION_BATCH_SIZE: process.env.RECOGNITION_BATCH_SIZE || 4,
    RECOGNITION_BATCH_CONCURRENCY: process.env.RECOGNITION_BATCH_CONCURRENCY || 2,
    OCR_REQUEST_TIMEOUT_MS: process.env.OCR_REQUEST_TIMEOUT_MS || 20_000,
    OCR_MAX_OUTPUT_TOKENS: process.env.OCR_MAX_OUTPUT_TOKENS || 1_024,
    OCR_REASONING_EFFORT: process.env.OCR_REASONING_EFFORT || 'low',
    OPENROUTER_OCR_PROVIDER: process.env.OPENROUTER_OCR_PROVIDER || 'google-ai-studio/flex',
    OPENROUTER_PREFERRED_MAX_LATENCY_SECONDS: process.env.OPENROUTER_PREFERRED_MAX_LATENCY_SECONDS || 5,
    OPENROUTER_PREFERRED_MIN_THROUGHPUT: process.env.OPENROUTER_PREFERRED_MIN_THROUGHPUT || 60,
    NEXT_PUBLIC_APP_URL: resolveAppUrl(),
    NODE_ENV: process.env.NODE_ENV || 'development',
  });

  if (!result.success) {
    const missing = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join(', ');
    throw new Error(`[Config Error] Ошибки конфигурации окружения: ${missing}`);
  }

  parsedConfig = result.data;
  return parsedConfig;
}

export function getPublicConfig() {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY || '',
    appUrl: resolveAppUrl(),
  };
}
