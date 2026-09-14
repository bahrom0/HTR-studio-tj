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
  emptyLabel: string;
  emptyAction: string;
  emptyHref: string;
  ariaLabel: string;
  continueLabel: string;
};

export function DocumentList({
  documents,
  emptyLabel,
  emptyAction,
  emptyHref,
  ariaLabel,
  continueLabel,
}: Readonly<DocumentListProps>) {
  if (documents.length === 0) {
    return (
      <div className="empty-state">
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
      {documents.map((document) => (
        <li className="document-row" key={document.id}>
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
