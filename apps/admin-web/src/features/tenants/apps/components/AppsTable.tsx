// CR-121 c12 · R3 · Công ty › Ứng dụng: dải "Cần xử lý" (Q5) + bảng app + 4 ô số chỉ xem + "Mở Quy trình" (artboard Company).
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useTr } from "@/lib/use-translate";
import { useJobName } from "../../flows/lib/use-job-name";
import type { Attention } from "../lib/apps-table";
import { AppRow, type AppRowProps, ROW_GRID } from "./AppRow";
import { LevelHelp } from "./LevelControl";

export type Tile = { label: string; value: string; sub?: string };

export function AttentionStrip({
  items,
  onAssign,
}: {
  items: readonly Attention[];
  onAssign: (slot: string) => void;
}) {
  const { t } = useTranslation();
  const tr = useTr();
  const jobName = useJobName();
  if (items.length === 0) return null;
  return (
    <section
      aria-label={t("tenants.apps.attention")}
      className="space-y-2"
      data-testid="apps-attention"
    >
      <h2 className="flex items-center gap-2 text-label font-semibold">
        {t("tenants.apps.attention")}
        <span className="rounded-full bg-warning-bg px-2 text-caption text-warning">
          {items.length}
        </span>
      </h2>
      <ul className="space-y-1">
        {items.map((a) => (
          <li
            key={a.slot}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-body"
          >
            <span className="min-w-0 flex-1 truncate">
              {t("tenants.apps.attentionItem", {
                job: jobName({ slot: a.slot }),
                app: tr(`featmeta.app.${a.app}.name`),
              })}
            </span>
            <Button
              size="sm"
              data-testid={`apps-assign-${a.slot}`}
              onClick={() => onAssign(a.slot)}
            >
              {t("tenants.flows.assign")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AppsTable({ rows }: { rows: readonly AppRowProps[] }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-md border border-border" data-testid="apps-table">
      <div
        className={`${ROW_GRID} px-3 py-2 text-caption font-semibold text-muted-foreground`}
        role="presentation"
      >
        <span>{t("tenants.apps.col.app")}</span>
        <span className="flex items-center gap-1">
          {t("tenants.apps.col.access")}
          <LevelHelp />
        </span>
        <span>{t("tenants.apps.col.status")}</span>
        <span className="whitespace-nowrap">{t("tenants.apps.col.members")}</span>
        <span>{t("tenants.apps.col.flows")}</span>
      </div>
      {rows.map((r) => (
        <AppRow key={r.card.app} {...r} />
      ))}
    </div>
  );
}

export function StatTiles({
  tiles,
  onOpenFlows,
}: {
  tiles: readonly Tile[];
  onOpenFlows: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3" data-testid="apps-tiles">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((x) => (
          <div key={x.label} className="min-w-0 rounded-md border border-border p-3">
            <p className="truncate text-caption text-muted-foreground" title={x.label}>
              {x.label}
            </p>
            <p className="truncate text-h3 font-semibold" title={x.value}>
              {x.value}
              {x.sub ? (
                <small className="ml-1 text-caption font-normal text-muted-foreground">
                  {x.sub}
                </small>
              ) : null}
            </p>
          </div>
        ))}
      </div>
      <Button variant="outline" size="sm" data-testid="apps-open-flows" onClick={onOpenFlows}>
        {t("tenants.apps.openFlows")}
      </Button>
    </div>
  );
}
