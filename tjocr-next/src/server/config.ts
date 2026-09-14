import { z } from 'zod';

const envSchema = z.object({
  // Supabase public
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),

  // Supabase server secret
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
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

  // App settings
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type AppConfig = z.infer<typeof envSchema>;

let parsedConfig: AppConfig | null = null;

export function getServerConfig(): AppConfig {
  if (parsedConfig) {
    return parsedConfig;
  }

  const result = envSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
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
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
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
    appUrl: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  };
}
