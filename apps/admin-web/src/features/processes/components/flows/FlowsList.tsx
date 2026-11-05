// CR-120 · "Một trang Quy trình" (tenant_admin / platform đang xem một công ty): mọi quy trình công ty có, nhóm theo app, lọc bằng chip
// (app · nguồn · trạng thái). Náp lười từ ProcessesPage (không vào chunk đầu).
import { useTranslation } from "react-i18next";
import { FilterChips } from "@/components/shared/form/FilterChips";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import type { FlowsList as FlowsListData } from "../../hooks/use-flows-list";
import { appsOf, GENERAL_APP, groupByApp } from "../../lib/flows-view";
import type { RowActions } from "../ProcessesTable";
import { FlowItem } from "./FlowItem";

const k = (s: string) => `process.admin.flows.${s}`;

function Filters({ f }: { f: FlowsListData }) {
  const { t } = useTranslation();
  const tr = useTr();
  const appName = (a: string) =>
    a === GENERAL_APP ? t(k("app.general")) : tr(`featmeta.app.${a}.name`, { defaultValue: a });
  const chips = <V extends string>(vals: readonly V[], label: (v: V) => string) =>
    vals.map((value) => ({ value, label: label(value) }));
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="flows-filters">
      <FilterChips
        label={t(k("filter.app"))}
        chips={[
          { value: "all", label: t("process.admin.list.filter.all") },
          ...chips(appsOf(f.all), appName),
        ]}
        value={f.filter.app}
        onChange={(app) => f.setFilter({ ...f.filter, app })}
      />
      <FilterChips
        label={t(k("filter.source"))}
        chips={[
          { value: "all", label: t("process.admin.list.filter.all") },
          ...chips(["platform", "company"] as const, (v) => t(k(`source.${v}`))),
        ]}
        value={f.filter.source}
        onChange={(source) => f.setFilter({ ...f.filter, source })}
      />
      <FilterChips
        label={t(k("filter.status"))}
        chips={[
          { value: "all", label: t("process.admin.list.filter.all") },
          ...chips(["on", "off"] as const, (v) => t(k(`status.${v}`))),
        ]}
        value={f.filter.status}
        onChange={(status) => f.setFilter({ ...f.filter, status })}
      />
    </div>
  );
}

export default function FlowsList(p: {
  tid: string;
  flows: FlowsListData;
  actions: RowActions;
  canRun: boolean;
  isPlatform: boolean;
}) {
  const { t } = useTranslation();
  const tr = useTr();
  const f = p.flows;
  if (f.error instanceof ApiError && f.error.status === 403) return <ForbiddenState />;
  if (f.loading) return <p className="text-body text-muted-foreground">{t(k("loading"))}</p>;
  const groups = groupByApp(f.rows);
  return (
    <div className="space-y-4" data-testid="flows-list">
      <Filters f={f} />
      {f.error ? (
        <p role="alert" className="text-body text-destructive">
          {f.error.message}{" "}
          <Button variant="link" size="sm" className="h-auto p-0" onClick={f.refetch}>
            {t("common.retry")}
          </Button>
        </p>
      ) : null}
      {f.capsFailed ? <p className="text-body text-destructive">{t(k("loadFail"))}</p> : null}
      {groups.length === 0 ? <EmptyState message={t(k("empty"))} /> : null}
      {groups.map((g) => (
        <section key={g.app} className="space-y-2" data-testid={`flows-group-${g.app}`}>
          <h2 className="text-base font-semibold">
            {g.app === GENERAL_APP
              ? t(k("app.general"))
              : tr(`featmeta.app.${g.app}.name`, { defaultValue: g.app })}
          </h2>
          <ul className="space-y-2">
            {g.rows.map((r) => (
              <FlowItem
                key={r.id}
                row={r}
                tid={p.tid}
                deptName={f.deptName}
                actions={p.actions}
                canRun={p.canRun}
                isPlatform={p.isPlatform}
              />
            ))}
          </ul>
        </section>
      ))}
      {f.hasMore ? (
        <Button variant="outline" disabled={f.moreBusy} onClick={f.loadMore}>
          {t("process.admin.list.more")}
        </Button>
      ) : null}
    </div>
  );
}
