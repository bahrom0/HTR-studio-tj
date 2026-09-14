-- ==============================================================================
-- TJOCR Next — Clean Slate Initial Schema & RLS Policies
-- ==============================================================================
-- Migration: 20260914000001_initial_schema.sql
-- Полная очистка старых таблиц и создание новой схемы с RLS и приватным Storage

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 0. CLEAN SLATE: Очистка существующих таблиц, триггеров и старых политик
-- ------------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

-- Удаление новых таблиц (если они частично созданы)
DROP TABLE IF EXISTS public.exports CASCADE;
DROP TABLE IF EXISTS public.text_edits CASCADE;
DROP TABLE IF EXISTS public.line_results CASCADE;
DROP TABLE IF EXISTS public.job_outbox CASCADE;
DROP TABLE IF EXISTS public.jobs CASCADE;
DROP TABLE IF EXISTS public.regions CASCADE;
DROP TABLE IF EXISTS public.region_revisions CASCADE;
DROP TABLE IF EXISTS public.pages CASCADE;
DROP TABLE IF EXISTS public.assets CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Удаление устаревших таблиц из старой версии проекта
DROP TABLE IF EXISTS public.access_sessions CASCADE;
DROP TABLE IF EXISTS public.editor_drafts CASCADE;
DROP TABLE IF EXISTS public.pipeline_runs CASCADE;
DROP TABLE IF EXISTS public.preparation_jobs CASCADE;
DROP TABLE IF EXISTS public.demo_preset_regions CASCADE;
DROP TABLE IF EXISTS public.demo_recognition_presets CASCADE;
DROP TABLE IF EXISTS public.line_reconstruction_audits CASCADE;

-- Удаление старых политик хранилища для избежания конфликтов
DROP POLICY IF EXISTS "storage_insert_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "storage_select_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "storage_delete_own_folder" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated reads" ON storage.objects;
DROP POLICY IF EXISTS "Allow authenticated deletes" ON storage.objects;
DROP POLICY IF EXISTS "Allow anonymous uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow anonymous reads" ON storage.objects;

-- ------------------------------------------------------------------------------
-- 1. PROFILES
-- ------------------------------------------------------------------------------
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    locale TEXT NOT NULL DEFAULT 'ru' CHECK (locale IN ('ru', 'tg')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_own" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Trigger to automatically create profile on user creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, locale)
    VALUES (NEW.id, 'ru')
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 2. DOCUMENTS
-- ------------------------------------------------------------------------------
CREATE TABLE public.documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Без названия',
    state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'uploading', 'uploaded', 'detecting', 'lines_ready', 'recognizing', 'completed', 'failed')),
    expires_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX idx_documents_owner ON public.documents(owner_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_documents_expires ON public.documents(expires_at) WHERE expires_at IS NOT NULL AND deleted_at IS NULL;

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "documents_select_own" ON public.documents
    FOR SELECT USING (auth.uid() = owner_id AND deleted_at IS NULL);

CREATE POLICY "documents_insert_own" ON public.documents
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "documents_update_own" ON public.documents
    FOR UPDATE USING (auth.uid() = owner_id AND deleted_at IS NULL)
    WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "documents_delete_own" ON public.documents
    FOR DELETE USING (auth.uid() = owner_id);

-- ------------------------------------------------------------------------------
-- 3. ASSETS (Private storage files)
-- ------------------------------------------------------------------------------
CREATE TABLE public.assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    object_key TEXT UNIQUE NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('source', 'normalized', 'crop', 'export')),
    mime TEXT NOT NULL,
    bytes BIGINT NOT NULL DEFAULT 0,
    checksum TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'committed', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX idx_assets_document ON public.assets(document_id);
CREATE INDEX idx_assets_owner ON public.assets(owner_id);

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "assets_select_own" ON public.assets
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "assets_insert_own" ON public.assets
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "assets_update_own" ON public.assets
    FOR UPDATE USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

-- ------------------------------------------------------------------------------
-- 4. PAGES
-- ------------------------------------------------------------------------------
CREATE TABLE public.pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    source_asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
    normalized_asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    image_revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX idx_pages_document ON public.pages(document_id);

ALTER TABLE public.pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pages_select_own" ON public.pages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = pages.document_id AND d.owner_id = auth.uid()
        )
    );

CREATE POLICY "pages_insert_own" ON public.pages
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = pages.document_id AND d.owner_id = auth.uid()
        )
    );

CREATE POLICY "pages_update_own" ON public.pages
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = pages.document_id AND d.owner_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = pages.document_id AND d.owner_id = auth.uid()
        )
    );

-- ------------------------------------------------------------------------------
-- 5. REGION REVISIONS & REGIONS (Geometry)
-- ------------------------------------------------------------------------------
CREATE TABLE public.region_revisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_id UUID NOT NULL REFERENCES public.pages(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    image_revision INTEGER NOT NULL DEFAULT 1,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    UNIQUE(page_id, revision_number)
);

CREATE INDEX idx_region_revisions_page ON public.region_revisions(page_id);

ALTER TABLE public.region_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "region_revisions_select_own" ON public.region_revisions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.pages p
            JOIN public.documents d ON d.id = p.document_id
            WHERE p.id = region_revisions.page_id AND d.owner_id = auth.uid()
        )
    );

CREATE POLICY "region_revisions_insert_own" ON public.region_revisions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.pages p
            JOIN public.documents d ON d.id = p.document_id
            WHERE p.id = region_revisions.page_id AND d.owner_id = auth.uid()
        )
    );

CREATE TABLE public.regions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    revision_id UUID NOT NULL REFERENCES public.region_revisions(id) ON DELETE CASCADE,
    reading_order INTEGER NOT NULL,
    geometry JSONB NOT NULL,
    excluded BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    UNIQUE(revision_id, reading_order)
);

CREATE INDEX idx_regions_revision ON public.regions(revision_id);

ALTER TABLE public.regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "regions_select_own" ON public.regions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.region_revisions rr
            JOIN public.pages p ON p.id = rr.page_id
            JOIN public.documents d ON d.id = p.document_id
            WHERE rr.id = regions.revision_id AND d.owner_id = auth.uid()
        )
    );

CREATE POLICY "regions_insert_own" ON public.regions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.region_revisions rr
            JOIN public.pages p ON p.id = rr.page_id
            JOIN public.documents d ON d.id = p.document_id
            WHERE rr.id = regions.revision_id AND d.owner_id = auth.uid()
        )
    );

CREATE POLICY "regions_update_own" ON public.regions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.region_revisions rr
            JOIN public.pages p ON p.id = rr.page_id
            JOIN public.documents d ON d.id = p.document_id
            WHERE rr.id = regions.revision_id AND d.owner_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.region_revisions rr
            JOIN public.pages p ON p.id = rr.page_id
            JOIN public.documents d ON d.id = p.document_id
            WHERE rr.id = regions.revision_id AND d.owner_id = auth.uid()
        )
    );

CREATE POLICY "regions_delete_own" ON public.regions
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.region_revisions rr
            JOIN public.pages p ON p.id = rr.page_id
            JOIN public.documents d ON d.id = p.document_id
            WHERE rr.id = regions.revision_id AND d.owner_id = auth.uid()
        )
    );

-- ------------------------------------------------------------------------------
-- 6. JOBS & OUTBOX (Durable Workflows)
-- ------------------------------------------------------------------------------
CREATE TABLE public.jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('detection', 'recognition', 'test_step', 'cleanup')),
    revision_id UUID REFERENCES public.region_revisions(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'cancelling', 'cancelled', 'succeeded', 'partial', 'failed')),
    completed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    total_count INTEGER NOT NULL DEFAULT 0,
    idempotency_key TEXT,
    workflow_id TEXT,
    error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX idx_jobs_owner ON public.jobs(owner_id);
CREATE INDEX idx_jobs_document ON public.jobs(document_id);
CREATE UNIQUE INDEX idx_jobs_idempotency ON public.jobs(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jobs_select_own" ON public.jobs
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "jobs_insert_own" ON public.jobs
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "jobs_update_own" ON public.jobs
    FOR UPDATE USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

CREATE TABLE public.job_outbox (
    job_id UUID PRIMARY KEY REFERENCES public.jobs(id) ON DELETE CASCADE,
    dispatch_state TEXT NOT NULL DEFAULT 'pending' CHECK (dispatch_state IN ('pending', 'dispatched', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX idx_job_outbox_pending ON public.job_outbox(dispatch_state, next_attempt_at)
    WHERE dispatch_state = 'pending';

ALTER TABLE public.job_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "job_outbox_select_own" ON public.job_outbox
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id = job_outbox.job_id AND j.owner_id = auth.uid()
        )
    );

CREATE POLICY "job_outbox_insert_own" ON public.job_outbox
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id = job_outbox.job_id AND j.owner_id = auth.uid()
        )
    );

CREATE POLICY "job_outbox_update_own" ON public.job_outbox
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id = job_outbox.job_id AND j.owner_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id = job_outbox.job_id AND j.owner_id = auth.uid()
        )
    );

-- ------------------------------------------------------------------------------
-- 7. LINE RESULTS & TEXT EDITS
-- ------------------------------------------------------------------------------
CREATE TABLE public.line_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
    region_id UUID NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
    crop_asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    raw_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW()),
    UNIQUE(job_id, region_id, attempt)
);

CREATE INDEX idx_line_results_job ON public.line_results(job_id);
CREATE INDEX idx_line_results_region ON public.line_results(region_id);

ALTER TABLE public.line_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "line_results_select_own" ON public.line_results
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.jobs j
            WHERE j.id = line_results.job_id AND j.owner_id = auth.uid()
        )
    );

CREATE TABLE public.text_edits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    line_result_id UUID NOT NULL REFERENCES public.line_results(id) ON DELETE CASCADE,
    edited_text TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX idx_text_edits_line_result ON public.text_edits(line_result_id);

ALTER TABLE public.text_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "text_edits_select_own" ON public.text_edits
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.line_results lr
            JOIN public.jobs j ON j.id = lr.job_id
            WHERE lr.id = text_edits.line_result_id AND j.owner_id = auth.uid()
        )
    );

CREATE POLICY "text_edits_insert_own" ON public.text_edits
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.line_results lr
            JOIN public.jobs j ON j.id = lr.job_id
            WHERE lr.id = text_edits.line_result_id AND j.owner_id = auth.uid()
        )
    );

CREATE POLICY "text_edits_update_own" ON public.text_edits
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.line_results lr
            JOIN public.jobs j ON j.id = lr.job_id
            WHERE lr.id = text_edits.line_result_id AND j.owner_id = auth.uid()
        )
    ) WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.line_results lr
            JOIN public.jobs j ON j.id = lr.job_id
            WHERE lr.id = text_edits.line_result_id AND j.owner_id = auth.uid()
        )
    );

-- ------------------------------------------------------------------------------
-- 8. EXPORTS
-- ------------------------------------------------------------------------------
CREATE TABLE public.exports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    result_revision INTEGER NOT NULL DEFAULT 1,
    format TEXT NOT NULL CHECK (format IN ('txt', 'docx')),
    asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX idx_exports_document ON public.exports(document_id);

ALTER TABLE public.exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "exports_select_own" ON public.exports
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.documents d
            WHERE d.id = exports.document_id AND d.owner_id = auth.uid()
        )
    );

-- ------------------------------------------------------------------------------
-- 9. STORAGE BUCKET & POLICIES (htr-uploads)
-- ------------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('htr-uploads', 'htr-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "storage_insert_own_folder" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'htr-uploads'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "storage_select_own_folder" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'htr-uploads'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

CREATE POLICY "storage_delete_own_folder" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'htr-uploads'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );
