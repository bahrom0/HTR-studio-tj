-- TJOCR Next — Stage 2: accounts, quotas, retention and request protection
-- Apply after 20260914000001_initial_schema.sql.
--
-- The public RPCs are deliberately small wrappers. The quota and rate-limit
-- implementation lives in the private schema so it is not exposed through
-- the Supabase Data API. All authorization decisions use auth.uid() and
-- auth.users.is_anonymous; client metadata is never trusted.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Document byte accounting and safe timestamps
-- -----------------------------------------------------------------------------
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS bytes BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'documents_bytes_nonnegative'
      AND conrelid = 'public.documents'::regclass
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_bytes_nonnegative CHECK (bytes >= 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = pg_catalog.timezone('utc'::text, pg_catalog.now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS documents_set_updated_at ON public.documents;
CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The profile trigger is retained for existing projects, but its search path
-- is pinned so a mutable object cannot be injected into a SECURITY DEFINER
-- execution context.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, locale)
  VALUES (NEW.id, 'ru')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Private quota and rate-limit state
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS private.quota_policies (
  plan TEXT PRIMARY KEY CHECK (plan IN ('anonymous', 'authenticated')),
  max_documents INTEGER NOT NULL CHECK (max_documents > 0),
  max_bytes BIGINT NOT NULL CHECK (max_bytes > 0),
  window_days INTEGER NOT NULL CHECK (window_days > 0),
  ttl_days INTEGER NOT NULL CHECK (ttl_days >= 0)
);

INSERT INTO private.quota_policies (plan, max_documents, max_bytes, window_days, ttl_days)
VALUES
  ('anonymous', 3, 31457280, 7, 7),
  ('authenticated', 100, 1073741824, 30, 0)
ON CONFLICT (plan) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.rate_limit_buckets (
  bucket_key TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (bucket_key, window_start)
);

REVOKE ALL ON TABLE private.quota_policies, private.rate_limit_buckets FROM PUBLIC;
GRANT SELECT ON TABLE private.quota_policies TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE private.rate_limit_buckets TO service_role;

-- -----------------------------------------------------------------------------
-- 3. Atomic document creation with quota enforcement
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.create_document_with_quota(
  p_title TEXT,
  p_bytes BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $$
DECLARE
  v_owner_id UUID := auth.uid();
  v_is_anonymous BOOLEAN;
  v_policy private.quota_policies%ROWTYPE;
  v_window_start TIMESTAMPTZ;
  v_used_documents BIGINT;
  v_used_bytes BIGINT;
  v_reset_at TIMESTAMPTZ;
  v_title TEXT;
  v_expires_at TIMESTAMPTZ;
  v_document public.documents%ROWTYPE;
BEGIN
  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unauthorized');
  END IF;

  IF p_bytes IS NULL OR p_bytes < 1 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'bytes');
  END IF;

  SELECT u.is_anonymous
  INTO v_is_anonymous
  FROM auth.users AS u
  WHERE u.id = v_owner_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'unauthorized');
  END IF;

  SELECT *
  INTO v_policy
  FROM private.quota_policies
  WHERE plan = CASE WHEN v_is_anonymous THEN 'anonymous' ELSE 'authenticated' END;

  -- Serialize reservations for one account. The document insert happens in
  -- this same transaction, so two concurrent uploads cannot pass the limit.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::TEXT, 0)
  );

  v_window_start := pg_catalog.now() - pg_catalog.make_interval(days => v_policy.window_days);

  SELECT
    count(*)::BIGINT,
    coalesce(sum(d.bytes), 0)::BIGINT,
    coalesce(
      min(d.created_at) + pg_catalog.make_interval(days => v_policy.window_days),
      pg_catalog.now() + pg_catalog.make_interval(days => v_policy.window_days)
    )
  INTO v_used_documents, v_used_bytes, v_reset_at
  FROM public.documents AS d
  WHERE d.owner_id = v_owner_id
    AND d.deleted_at IS NULL
    AND d.created_at >= v_window_start;

  IF v_used_documents >= v_policy.max_documents THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'documents',
      'quota', jsonb_build_object(
        'plan', v_policy.plan,
        'usedDocuments', v_used_documents,
        'maxDocuments', v_policy.max_documents,
        'usedBytes', v_used_bytes,
        'maxBytes', v_policy.max_bytes,
        'windowDays', v_policy.window_days,
        'resetAt', v_reset_at
      )
    );
  END IF;

  IF v_used_bytes + p_bytes > v_policy.max_bytes THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'bytes',
      'quota', jsonb_build_object(
        'plan', v_policy.plan,
        'usedDocuments', v_used_documents,
        'maxDocuments', v_policy.max_documents,
        'usedBytes', v_used_bytes,
        'maxBytes', v_policy.max_bytes,
        'windowDays', v_policy.window_days,
        'resetAt', v_reset_at
      )
    );
  END IF;

  v_title := left(coalesce(nullif(pg_catalog.btrim(p_title), ''), 'Новый документ'), 200);
  v_expires_at := CASE
    WHEN v_policy.ttl_days > 0
      THEN pg_catalog.now() + pg_catalog.make_interval(days => v_policy.ttl_days)
    ELSE NULL
  END;

  INSERT INTO public.documents (owner_id, title, state, expires_at, bytes)
  VALUES (v_owner_id, v_title, 'draft', v_expires_at, p_bytes)
  RETURNING * INTO v_document;

  RETURN jsonb_build_object(
    'allowed', true,
    'document', to_jsonb(v_document),
    'quota', jsonb_build_object(
      'plan', v_policy.plan,
      'usedDocuments', v_used_documents + 1,
      'maxDocuments', v_policy.max_documents,
      'usedBytes', v_used_bytes + p_bytes,
      'maxBytes', v_policy.max_bytes,
      'windowDays', v_policy.window_days,
      'resetAt', v_reset_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.create_document_with_quota(TEXT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.create_document_with_quota(TEXT, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_document_with_quota(
  p_title TEXT,
  p_bytes BIGINT
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT private.create_document_with_quota($1, $2);
$$;

REVOKE ALL ON FUNCTION public.create_document_with_quota(TEXT, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_document_with_quota(TEXT, BIGINT) TO authenticated;

CREATE OR REPLACE FUNCTION private.get_document_quota()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private, auth
AS $$
DECLARE
  v_owner_id UUID := auth.uid();
  v_is_anonymous BOOLEAN;
  v_policy private.quota_policies%ROWTYPE;
  v_window_start TIMESTAMPTZ;
  v_used_documents BIGINT;
  v_used_bytes BIGINT;
  v_reset_at TIMESTAMPTZ;
BEGIN
  IF v_owner_id IS NULL THEN
    RETURN jsonb_build_object('quota', NULL);
  END IF;

  SELECT u.is_anonymous INTO v_is_anonymous FROM auth.users AS u WHERE u.id = v_owner_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('quota', NULL); END IF;

  SELECT * INTO v_policy FROM private.quota_policies
  WHERE plan = CASE WHEN v_is_anonymous THEN 'anonymous' ELSE 'authenticated' END;
  v_window_start := pg_catalog.now() - pg_catalog.make_interval(days => v_policy.window_days);

  SELECT
    count(*)::BIGINT,
    coalesce(sum(d.bytes), 0)::BIGINT,
    coalesce(
      min(d.created_at) + pg_catalog.make_interval(days => v_policy.window_days),
      pg_catalog.now() + pg_catalog.make_interval(days => v_policy.window_days)
    )
  INTO v_used_documents, v_used_bytes, v_reset_at
  FROM public.documents AS d
  WHERE d.owner_id = v_owner_id AND d.deleted_at IS NULL AND d.created_at >= v_window_start;

  RETURN jsonb_build_object(
    'quota', jsonb_build_object(
      'plan', v_policy.plan,
      'usedDocuments', v_used_documents,
      'maxDocuments', v_policy.max_documents,
      'usedBytes', v_used_bytes,
      'maxBytes', v_policy.max_bytes,
      'windowDays', v_policy.window_days,
      'resetAt', v_reset_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION private.get_document_quota() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.get_document_quota() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_document_quota()
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT private.get_document_quota();
$$;

REVOKE ALL ON FUNCTION public.get_document_quota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_document_quota() TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. Optional durable rate limiting for server-only requests
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.check_rate_limit(
  p_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, private
AS $$
DECLARE
  v_start TIMESTAMPTZ;
  v_count INTEGER;
  v_reset_at TIMESTAMPTZ;
BEGIN
  IF p_key IS NULL OR pg_catalog.length(p_key) = 0 OR p_limit < 1 OR p_window_seconds < 1 THEN
    RETURN jsonb_build_object('allowed', false, 'resetAt', pg_catalog.now());
  END IF;

  v_start := pg_catalog.to_timestamp(
    (
      pg_catalog.floor(extract(epoch FROM pg_catalog.clock_timestamp()) / p_window_seconds)
        * p_window_seconds
    )::double precision
  );
  v_reset_at := v_start + pg_catalog.make_interval(secs => p_window_seconds);

  DELETE FROM private.rate_limit_buckets
  WHERE bucket_key = pg_catalog.left(p_key, 256)
    AND window_start < v_start - pg_catalog.make_interval(secs => p_window_seconds * 2);

  INSERT INTO private.rate_limit_buckets (bucket_key, window_start, request_count)
  VALUES (pg_catalog.left(p_key, 256), v_start, 1)
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET request_count = private.rate_limit_buckets.request_count + 1
  RETURNING request_count INTO v_count;

  RETURN jsonb_build_object(
    'allowed', v_count <= p_limit,
    'remaining', greatest(0, p_limit - v_count),
    'resetAt', v_reset_at
  );
END;
$$;

REVOKE ALL ON FUNCTION private.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_key TEXT,
  p_limit INTEGER,
  p_window_seconds INTEGER
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, private
AS $$
  SELECT private.check_rate_limit($1, $2, $3);
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) TO service_role;

-- -----------------------------------------------------------------------------
-- 5. RLS, grants and Storage update policy
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "documents_select_own" ON public.documents;
CREATE POLICY "documents_select_own" ON public.documents
  FOR SELECT TO authenticated
  USING (
    auth.uid() = owner_id
    AND deleted_at IS NULL
    AND (expires_at IS NULL OR expires_at > pg_catalog.now())
  );

DROP POLICY IF EXISTS "documents_update_own" ON public.documents;
CREATE POLICY "documents_update_own" ON public.documents
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = owner_id
    AND deleted_at IS NULL
    AND (expires_at IS NULL OR expires_at > pg_catalog.now())
  )
  WITH CHECK (auth.uid() = owner_id);

-- Browser clients must create documents through the quota RPC; a direct INSERT
-- would otherwise let a user bypass the reservation transaction.
DROP POLICY IF EXISTS "documents_insert_own" ON public.documents;
REVOKE INSERT ON public.documents FROM anon, authenticated;

DROP POLICY IF EXISTS "assets_insert_own" ON public.assets;
CREATE POLICY "assets_insert_own" ON public.assets
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND EXISTS (
      SELECT 1 FROM public.documents AS d
      WHERE d.id = assets.document_id AND d.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "assets_update_own" ON public.assets;
CREATE POLICY "assets_update_own" ON public.assets
  FOR UPDATE TO authenticated
  USING (
    auth.uid() = owner_id
    AND EXISTS (
      SELECT 1 FROM public.documents AS d
      WHERE d.id = assets.document_id AND d.owner_id = auth.uid()
    )
  )
  WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "jobs_insert_own" ON public.jobs;
CREATE POLICY "jobs_insert_own" ON public.jobs
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    AND EXISTS (
      SELECT 1 FROM public.documents AS d
      WHERE d.id = jobs.document_id AND d.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "storage_update_own_folder" ON storage.objects;
CREATE POLICY "storage_update_own_folder" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'htr-uploads'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'htr-uploads'
    AND auth.uid()::TEXT = (storage.foldername(name))[1]
  );

GRANT SELECT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.profiles,
  public.assets,
  public.pages,
  public.region_revisions,
  public.regions,
  public.jobs,
  public.job_outbox,
  public.line_results,
  public.text_edits,
  public.exports
TO authenticated;

COMMIT;
