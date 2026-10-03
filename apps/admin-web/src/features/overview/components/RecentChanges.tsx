// ADM-FR-41, ADM-FR-42 · card "Thay đổi gần đây": ≤ 8 dòng audit, câu từ `auditSentence` + giờ.
import type { AuditItem } from "@ai/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { auditSentence } from "@/lib/audit-sentence";
import { formatClock } from "@/lib/format";
import type { LoadError } from "@/lib/load-error";
import { useTr } from "@/lib/use-translate";
import { Panel } from "./Panel";

type Props = {
  items: AuditItem[] | undefined;
  emptyKey: "overview.recent.empty" | "overview.recent.emptyPlatform";
  loading?: boolean;
  error?: (LoadError & { onRetry?: () => void }) | null;
};

export function RecentChanges({ items, emptyKey, loading, error }: Props) {
  const { t } = useTranslation();
  const tr = useTr();
  return (
    <Panel
      title={t("overview.recent.title")}
      loading={loading}
      error={error}
      footer={
        <Link to={"/audit" as "/"} className="font-medium text-primary hover:underline">
          {t("overview.recent.link")}
        </Link>
      }
    >
      {items?.length ? (
        <ul className="space-y-2">
          {items.map((i) => (
            <li key={i.id} className="flex items-baseline justify-between gap-3 text-body">
              <span className="min-w-0 truncate">{auditSentence(i, tr)}</span>
              <time dateTime={i.at} className="shrink-0 text-caption text-muted-foreground">
                {formatClock(i.at)}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body text-muted-foreground">{t(emptyKey)}</p>
      )}
    </Panel>
  );
}
