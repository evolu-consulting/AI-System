// ADM-FR-51 · M4-R12 · danh sách nhóm theo ngày + "Tải thêm"; trạng thái đang tải / rỗng / lỗi.
import type { AuditItem } from "@ai/contracts";
import { History } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { LoadError } from "@/lib/load-error";
import { dayLabel, groupByDay } from "../lib/group-by-day";
import type { AuditSearch } from "../lib/search";
import { AuditRow } from "./AuditRow";

type Props = {
  items: AuditItem[];
  search: AuditSearch;
  loading: boolean;
  error?: (LoadError & { onRetry?: () => void }) | null;
  filtered: boolean;
  onClear: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
};

const SKELETON_ROWS = ["a", "b", "c", "d", "e", "f", "g", "h"];

export function AuditTimeline(p: Props) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupByDay(p.items), [p.items]);
  const now = useMemo(() => new Date(), []);
  if (p.error) return <ErrorState {...p.error} />;
  if (p.loading) {
    return (
      <div aria-busy className="space-y-2">
        {SKELETON_ROWS.map((k) => (
          <Skeleton key={k} className="h-11 w-full" />
        ))}
      </div>
    );
  }
  if (p.items.length === 0) {
    return (
      <EmptyState
        icon={History}
        message={p.filtered ? t("audit.emptyFiltered") : t("audit.empty")}
        action={
          p.filtered ? (
            <Button type="button" variant="outline" onClick={p.onClear}>
              {t("common.clearFilters")}
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => {
        const label = dayLabel(g.day, now);
        return (
          <section key={g.day} className="rounded-lg border border-border bg-card">
            <h2 className="border-b border-border px-3 py-2 text-label font-semibold text-muted-foreground">
              {label === "today" || label === "yesterday" ? t(`audit.${label}`) : label}
            </h2>
            <ul aria-label={t("audit.title")}>
              {g.items.map((i) => (
                <AuditRow key={i.id} item={i} search={p.search} />
              ))}
            </ul>
          </section>
        );
      })}
      {p.hasMore ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" disabled={p.loadingMore} onClick={p.onLoadMore}>
            {t("audit.loadMore")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
