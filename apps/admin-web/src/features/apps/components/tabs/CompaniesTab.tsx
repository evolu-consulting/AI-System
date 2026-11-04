// CR-118 · cr118-app-config · tab "Công ty": bảng công ty × mức × tính năng thêm × quy trình theo khe × số người; bấm dòng ⇒ ngăn bên phải chứa
// ĐÚNG thẻ app + khe của công ty đó (TenantFeaturesTab: cùng AppCard, cùng AppsSaveBar, cùng một đường lưu với trang công ty).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FilterChips } from "@/components/shared/form/FilterChips";
import { SearchBox } from "@/components/shared/form/SearchBox";
import { StatusBadge, type StatusTone } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/states/EmptyState";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import TenantFeaturesTab from "@/features/tenants/components/features/TenantFeaturesTab";
import { loadError } from "@/lib/load-error";
import type { AssignedMap } from "../../hooks/use-app-processes";
import {
  type CompanyLevel,
  type CompanyRow,
  canSwitchCompany,
  countByLevel,
  filterCompanies,
} from "../../lib/app-config";

const TONE: Record<CompanyLevel, StatusTone> = {
  off: "off",
  read: "info",
  write: "ok",
  admin: "ok",
};
const LEVELS: readonly CompanyLevel[] = ["off", "read", "write", "admin"];
type LevelFilter = "all" | CompanyLevel;

type Props = {
  appKey: string;
  rows: CompanyRow[];
  pending: boolean;
  error: unknown;
  onRetry: () => void;
  assigned: AssignedMap;
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  dirty: boolean;
  onDirtyChange: (d: boolean) => void;
  onDraft: (keys: ReadonlySet<string> | null) => void;
  onPreview: () => void;
};

export function CompaniesTab(p: Props) {
  const { t } = useTranslation();
  const [level, setLevel] = useState<LevelFilter>("all");
  const [q, setQ] = useState("");
  const [blocked, setBlocked] = useState(false);
  const err = loadError(p.error);
  if (err) return <ErrorState message={err.message} code={err.code} onRetry={p.onRetry} />;
  if (p.pending) return <LoadingState />;
  const counts = countByLevel(p.rows);
  const shown = filterCompanies(p.rows, { level: level === "all" ? undefined : level, q });
  const selected = p.rows.find((r) => r.id === p.selectedId);
  const pick = (id: string) => {
    if (!canSwitchCompany(p.dirty, p.selectedId, id)) return setBlocked(true);
    setBlocked(false);
    p.onSelect(id);
  };
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <FilterChips<LevelFilter>
            label={t("appcfg.companies.levelFilter")}
            value={level}
            onChange={setLevel}
            chips={[
              { value: "all", label: t("common.all"), count: p.rows.length },
              ...LEVELS.map((l) => ({
                value: l,
                label: t(`tenants.features.level.${l}`),
                count: counts[l],
              })),
            ]}
          />
          <div className="ml-auto w-full sm:w-auto">
            <SearchBox label={t("appcfg.companies.search")} value={q} onChange={setQ} />
          </div>
        </div>
        {blocked ? (
          <p role="alert" className="text-caption text-warning">
            {t("appcfg.companies.blocked")}
          </p>
        ) : null}
        {shown.length === 0 ? (
          <EmptyState
            message={t(p.rows.length === 0 ? "appcfg.companies.empty" : "appcfg.companies.noMatch")}
          />
        ) : (
          <Table>
            <caption className="sr-only">{t("appcfg.tab.companies")}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>{t("appcfg.companies.col.name")}</TableHead>
                <TableHead>{t("appcfg.companies.col.level")}</TableHead>
                <TableHead>{t("appcfg.companies.col.addons")}</TableHead>
                <TableHead>{t("appcfg.companies.col.flows")}</TableHead>
                <TableHead className="text-right">{t("appcfg.companies.col.users")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => (
                <TableRow key={r.id} data-state={r.id === p.selectedId ? "selected" : undefined}>
                  <TableCell>
                    <Button
                      variant="link"
                      className="h-auto p-0 font-medium"
                      onClick={() => pick(r.id)}
                      aria-label={t("appcfg.companies.open", { name: r.name })}
                    >
                      {r.name}
                    </Button>
                    {r.locked ? (
                      <StatusBadge tone="err" className="ml-2">
                        {t("appcfg.companies.locked")}
                      </StatusBadge>
                    ) : null}
                    <span className="block font-mono text-caption text-muted-foreground">
                      {r.key}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={TONE[r.level]}>
                      {t(`tenants.features.level.${r.level}`)}
                    </StatusBadge>
                  </TableCell>
                  <TableCell>{r.addons > 0 ? r.addons : "—"}</TableCell>
                  <TableCell className="whitespace-normal">
                    {(p.assigned[r.id] ?? []).map((a) => a.name).join(", ") ||
                      t("appcfg.companies.flowDefault")}
                  </TableCell>
                  <TableCell className="text-right">{r.users}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <aside
        aria-label={t("appcfg.companies.drawer")}
        className="space-y-3 rounded-xl border border-border bg-muted/20 p-4 xl:sticky xl:top-4"
      >
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="truncate text-h3 font-semibold">{selected.name}</h3>
                <p className="text-caption text-muted-foreground">
                  {t("appcfg.companies.drawerHint")}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={p.dirty}
                title={p.dirty ? t("appcfg.companies.blocked") : undefined}
                onClick={() => p.onSelect(undefined)}
              >
                {t("common.close")}
              </Button>
            </div>
            <TenantFeaturesTab
              key={selected.id}
              tenant={{ id: selected.id, name: selected.name }}
              onlyApp={p.appKey}
              onDirtyChange={p.onDirtyChange}
              onDraft={p.onDraft}
            />
            <Button variant="outline" onClick={p.onPreview}>
              {t("appcfg.companies.preview")}
            </Button>
          </>
        ) : (
          <p className="py-8 text-center text-body text-muted-foreground">
            {t("appcfg.companies.pickHint")}
          </p>
        )}
      </aside>
    </div>
  );
}
