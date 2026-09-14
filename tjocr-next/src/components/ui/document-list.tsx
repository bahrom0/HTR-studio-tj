import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

export type DocumentListItem = {
  id: string;
  title: string;
  updatedAt?: string;
  state?: string;
};

type DocumentListProps = {
  documents: readonly DocumentListItem[];
  isLoading?: boolean;
  emptyLabel: string;
  emptyAction: string;
  emptyHref: string;
  ariaLabel: string;
  continueLabel: string;
};

export function DocumentList({
  documents,
  isLoading = false,
  emptyLabel,
  emptyAction,
  emptyHref,
  ariaLabel,
  continueLabel,
}: Readonly<DocumentListProps>) {
  if (isLoading) {
    return (
      <div className="document-list document-list--skeleton" aria-busy="true" aria-live="polite">
        {[1, 2, 3].map((index) => (
          <div className="document-row document-row--skeleton" key={index}>
            <div className="document-row__copy">
              <div
                className="skeleton-shimmer document-skeleton-title"
                style={{ width: index === 1 ? '58%' : index === 2 ? '42%' : '66%' }}
              />
              <div
                className="skeleton-shimmer document-skeleton-meta"
                style={{ width: index === 2 ? '85px' : index === 3 ? '120px' : '105px' }}
              />
            </div>
            <div className="skeleton-shimmer document-skeleton-action" />
          </div>
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="empty-state empty-state--animated">
        <div className="empty-state__mark" aria-hidden="true">
          —
        </div>
        <p>{emptyLabel}</p>
        <Link className="text-action text-action--underlined" href={emptyHref}>
          {emptyAction}
          <ArrowRight aria-hidden="true" size={15} />
        </Link>
      </div>
    );
  }

  return (
    <ul className="document-list" aria-label={ariaLabel}>
      {documents.map((document, index) => (
        <li
          className="document-row document-row--animated"
          key={document.id}
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <div className="document-row__copy">
            <span className="document-row__title">{document.title}</span>
            {document.updatedAt ? <span className="document-row__meta">{document.updatedAt}</span> : null}
          </div>
          <Link className="text-action" href={`/app/documents/${document.id}`}>
            {continueLabel}
            <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </li>
      ))}
    </ul>
  );
}
