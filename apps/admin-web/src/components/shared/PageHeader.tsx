// ADM-FR-60 · H1 + mô tả + vùng nút phải; H1 nhận focus khi vào trang (a11y) và đặt document.title.
import { type ReactNode, useEffect, useRef } from "react";
import { useDocumentTitle } from "@/lib/use-document-title";

type Props = { title: string; description?: string; actions?: ReactNode };

export function PageHeader({ title, description, actions }: Props) {
  const ref = useRef<HTMLHeadingElement>(null);
  useDocumentTitle(title);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1
          ref={ref}
          tabIndex={-1}
          className="text-page-title font-bold text-foreground outline-none"
        >
          {title}
        </h1>
        {description ? <p className="mt-1 text-body text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
