import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFile(join(root, relativePath), 'utf8');

test('stage 2 migration contains quota, retention and Storage safeguards', async () => {
  const sql = await read('supabase/migrations/20260915000002_stage2_auth_quota_ttl_security.sql');
  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS private/i);
  assert.match(sql, /private\.create_document_with_quota/i);
  assert.match(sql, /private\.quota_policies/i);
  assert.match(sql, /documents_bytes_nonnegative/i);
  assert.match(sql, /storage_update_own_folder/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.check_rate_limit/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.create_document_with_quota\(TEXT, BIGINT\) TO authenticated/i);
  assert.doesNotMatch(sql, /pg_catalog\.extract\s*\(/i);
  assert.match(sql, /extract\(epoch FROM pg_catalog\.clock_timestamp\(\)\)/i);
});

test('privileged Supabase client never falls back to a public key', async () => {
  const source = await read('src/server/supabase/admin.ts');
  assert.doesNotMatch(source, /\|\|\s*config\.NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY is required/);
});

test('all account routes are present and use the shared protection helpers', async () => {
  const routes = [
    'src/app/api/v1/auth/anonymous/route.ts',
    'src/app/api/v1/auth/register/route.ts',
    'src/app/api/v1/auth/login/route.ts',
    'src/app/api/v1/auth/logout/route.ts',
    'src/app/api/v1/auth/session/route.ts',
  ];
  for (const route of routes) {
    const source = await read(route);
    assert.match(source, /jsonNoStore|errorResponse/);
  }
  assert.match(await read('src/app/api/v1/auth/register/route.ts'), /EMAIL_CONFIRMATION_REQUIRED/);
  assert.match(await read('src/app/api/v1/auth/anonymous/route.ts'), /signInAnonymously/);
});

test('Russian and Tajik dictionaries keep the same top-level contract', async () => {
  const ru = JSON.parse(await read('src/i18n/dictionaries/ru.json'));
  const tg = JSON.parse(await read('src/i18n/dictionaries/tg.json'));
  assert.deepEqual(Object.keys(tg).sort(), Object.keys(ru).sort());
  assert.deepEqual(Object.keys(tg.auth).sort(), Object.keys(ru.auth).sort());
  assert.deepEqual(Object.keys(tg.document).sort(), Object.keys(ru.document).sort());
});
