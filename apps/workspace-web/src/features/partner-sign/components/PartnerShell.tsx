// CR-182 · khung trang công khai của đối tác: không khung app, không đăng nhập. Meta `referrer=no-referrer` (token nằm trong đường dẫn) + noindex.
import type { ReactNode } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

function useMeta(name: string, content: string) {
  useEffect(() => {
    const m = document.createElement("meta");
    m.name = name;
    m.content = content;
    document.head.append(m);
    return () => m.remove();
  }, [name, content]);
}

export function PartnerShell({ company, children }: { company?: string; children: ReactNode }) {
  const { t } = useTranslation();
  useMeta("referrer", "no-referrer");
  useMeta("robots", "noindex, nofollow");
  return (
    <main className="min-h-screen bg-background text-foreground" data-testid="partner-page">
      <div className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-8">
        {company && (
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-md bg-primary text-md font-semibold text-primary-foreground"
            >
              {company.trim().charAt(0).toUpperCase()}
            </span>
            <span className="text-lg font-semibold" data-testid="partner-company">
              {company}
            </span>
          </div>
        )}
        {children}
        <p className="m-0 text-center text-sm text-muted-foreground">
          {t("contracts.psign.noAccount")}
        </p>
      </div>
    </main>
  );
}

/** Thẻ trạng thái: tiêu đề + nội dung + hành động. */
export function StatusCard(p: {
  title: string;
  body?: string;
  tone?: "ok" | "bad";
  testId: string;
  children?: ReactNode;
}) {
  return (
    <section
      role={p.tone === "bad" ? "alert" : "status"}
      data-testid={p.testId}
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5"
    >
      <h1 className="m-0 text-xl font-semibold">{p.title}</h1>
      {p.body && <p className="m-0 text-md">{p.body}</p>}
      {p.children}
    </section>
  );
}
