'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useLocale } from '@/components/app-shell';
import { Status } from '@/components/ui/status';
import { SiteLoader } from '@/components/ui/site-loader';

export default function DocumentHubPage() {
  const { dictionary: t } = useLocale();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/documents/${params.id}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('not_found');
        return (await response.json()) as { document?: { state: string } };
      })
      .then((payload) => {
        const state = payload.document?.state;
        if (state === 'completed' || state === 'recognizing') {
          router.replace(`/app/documents/${params.id}/recognize`);
        } else if (state === 'lines_ready') {
          router.replace(`/app/documents/${params.id}/lines`);
        } else if (state === 'detecting') {
          router.replace(`/app/documents/${params.id}/detect`);
        } else {
          router.replace(`/app/documents/${params.id}/upload`);
        }
      })
      .catch(() => setNotFound(true));
  }, [params.id, router]);

  if (notFound) {
    return (
      <div className="document-page">
        <section className="page-width py-12">
          <p className="text-sm text-status-danger mb-4">{t.document.notFound}</p>
          <Link className="text-action text-action--back" href="/app">
            <ArrowLeft aria-hidden="true" size={15} />
            {t.document.back}
          </Link>
        </section>
      </div>
    );
  }

  return <SiteLoader />;
}
