// HUB-FR-72 · tiêu đề trang (h1) + mô tả + vùng hành động; đặt `document.title`.
import type { ReactNode } from "react";
import { useDocumentTitle } from "#/lib/use-document-title";

type Props = { title: string; subtitle?: string; actions?: ReactNode };

export function PageHeader({ title, subtitle, actions }: Props) {
  useDocumentTitle(title);
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h1 className="text-page-title font-bold text-foreground">{title}</h1>
        {subtitle ? <p className="text-body text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions}
    </header>
  );
}
