'use client';

import Link from 'next/link';
import { ArrowRight, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocale } from '@/components/app-shell';
import { DocumentList, type DocumentListItem } from '@/components/ui/document-list';
import { SiteLoader } from '@/components/ui/site-loader';

type Quota = {
  usedDocuments: number;
  maxDocuments: number;
};

type DocumentsResponse = {
  documents?: Array<{
    id: string;
    title: string;
    updatedAt?: string;
  }>;
  quota?: Quota | null;
};

export default function HomePage() {
  const { dictionary: t, locale } = useLocale();
  const [documents, setDocuments] = useState<DocumentListItem[]>([]);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;

    fetch('/api/v1/documents', { cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) return null;
        if (!response.ok) throw new Error('documents_fetch_failed');
        return (await response.json()) as DocumentsResponse;
      })
      .then((payload) => {
        if (!active || !payload) return;
        setDocuments(
          (payload.documents || []).map((document) => ({
            id: document.id,
            title: document.title,
            updatedAt: document.updatedAt
              ? new Intl.DateTimeFormat(locale === 'tg' ? 'tg-TJ' : 'ru-RU', {
                  dateStyle: 'medium',
                }).format(new Date(document.updatedAt))
              : undefined,
          })),
        );
        setQuota(payload.quota || null);
      })
      .catch(() => {
        if (active) setLoadError(true);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [locale]);

  if (isLoading) return <SiteLoader />;

  const sectionMeta = quota
    ? `${t.home.quotaLabel}: ${Math.max(0, quota.maxDocuments - quota.usedDocuments)}/${quota.maxDocuments}`
    : t.home.emptyLabel;

  return (
    <div className="workspace-page">
      <section className="workspace-hero page-width" aria-labelledby="workspace-title">
        <div>
          <h1 id="workspace-title">{t.home.title}</h1>
          <p className="workspace-description">{t.home.description}</p>
        </div>
        <Link className="button button--primary button--large workspace-upload" href="/app/new">
          <Upload aria-hidden="true" size={16} />
          {t.home.uploadButton}
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
      </section>

      <section className="documents-section page-width" aria-labelledby="documents-title">
        <div className="section-heading">
          <div>
            <h2 id="documents-title">{t.home.recentTitle}</h2>
          </div>
          <span className="section-meta">{sectionMeta}</span>
        </div>

        {loadError ? <p className="documents-error" role="status">{t.home.loadError}</p> : null}

        <DocumentList
          documents={documents}
          ariaLabel={t.nav.documents}
          continueLabel={t.common.continue}
          emptyLabel={t.home.empty}
          emptyAction={t.home.startFirst}
          emptyHref="/app/new"
        />

        <p className="guest-note guest-note--workspace">
          <span className="info-mark" aria-hidden="true">
            i
          </span>
          {t.home.guestNotice}
        </p>
      </section>
    </div>
  );
}
