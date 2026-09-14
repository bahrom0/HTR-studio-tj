'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLocale } from '@/components/app-shell';

type DocumentRecord = {
  id: string;
  title: string;
  state: string;
  expiresAt?: string | null;
};

export default function DocumentPage() {
  const { dictionary: t, locale } = useLocale();
  const params = useParams<{ id: string }>();
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch('/api/v1/documents', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('document_fetch_failed');
        return (await response.json()) as { documents?: DocumentRecord[] };
      })
      .then((payload) => {
        const match = payload.documents?.find((item) => item.id === params.id) || null;
        setDocument(match);
        setNotFound(!match);
      })
      .catch(() => setNotFound(true))
      .finally(() => setIsLoading(false));
  }, [params.id]);

  return (
    <div className="workspace-page">
      <section className="document-detail page-width" aria-labelledby="document-detail-title">
        <Link className="text-action text-action--back" href="/app">
          <ArrowLeft aria-hidden="true" size={15} />
          {t.document.back}
        </Link>
        {isLoading ? <p className="workspace-description">{t.common.loading}</p> : null}
        {!isLoading && notFound ? <p className="workspace-description">{t.document.notFound}</p> : null}
        {!isLoading && document ? (
          <>
            <p className="eyebrow">{t.document.title}</p>
            <h1 id="document-detail-title">{document.title}</h1>
            <div className="document-detail__card">
              <span>{t.document.status}</span>
              <strong>{document.state}</strong>
              {document.expiresAt ? (
                <span>
                  {t.document.expires}: {new Intl.DateTimeFormat(locale === 'tg' ? 'tg-TJ' : 'ru-RU', { dateStyle: 'medium' }).format(new Date(document.expiresAt))}
                </span>
              ) : null}
            </div>
            <Link className="button button--primary button--large" href="/app/new">
              {t.document.nextStep}
            </Link>
          </>
        ) : null}
      </section>
    </div>
  );
}
