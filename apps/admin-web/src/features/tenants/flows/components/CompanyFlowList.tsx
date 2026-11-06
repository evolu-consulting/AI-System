// CR-122 · U2 · FLOW2-FR-05..09/20: MỘT danh sách flow của công ty (thay SlotRouting/RoutingRules/DrawerAssign): nhóm theo app; mỗi dòng
// = tên · Bắt đầu khi · nguồn · trạng thái + lý do · hành động. Kéo thả đổi thứ tự (chỉ có nghĩa cho sự kiện quyết định).
import type { CompanyFlowRow } from "@ai/contracts/hub-admin";
import { Link } from "@tanstack/react-router";
import { GripVertical } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { eventsOfApp } from "@/features/processes/lib/flow-def";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { type FlowOp, useCompanyFlowOp } from "../company-flows-api";
import { actionsOf, errorKey, groupByApp, reorderIds, statusKey } from "../lib/company-flow-view";

/** Cùng lưới cho tiêu đề và mọi dòng ⇒ cột thẳng mép. */
const GRID =
  "grid grid-cols-[1.5rem_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,auto)] items-center gap-3";

function triggerText(r: CompanyFlowRow, cond: string): string {
  const ev = eventsOfApp(r.app).find((e) => e.key === r.trigger_event);
  return `${ev?.label ?? r.trigger_event}${r.has_condition ? ` · ${cond}` : ""}`;
}

function Row(p: {
  r: CompanyFlowRow;
  tenantId: string;
  busy: boolean;
  onOp: (a: FlowOp) => void;
  onDrop: (fromId: string, toId: string) => void;
}) {
  const { t } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`tenants.companyFlows.${s}`, o);
  const { r } = p;
  const a = actionsOf(r);
  return (
    <li
      className={`${GRID} border-t border-border px-3 py-2`}
      draggable
      data-testid={`company-flow-${r.flow_key}`}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => p.onDrop(e.dataTransfer.getData("text/plain"), r.id)}
    >
      <GripVertical aria-hidden className="size-4 cursor-grab text-muted-foreground" />
      <div className="min-w-0">
        <p className="m-0 truncate text-body font-medium">{r.name}</p>
        {r.warnings.length > 0 ? (
          <p className="m-0 text-caption text-warning">{k("warn.shadowed")}</p>
        ) : null}
      </div>
      <p className="m-0 min-w-0 truncate text-body">{triggerText(r, k("withCondition"))}</p>
      <p className="m-0 min-w-0 truncate text-body text-muted-foreground">
        {r.source
          ? k("source.copy", { name: r.source.name, v: r.source.version })
          : r.kind === "assigned"
            ? k("source.assigned")
            : k("source.own")}
      </p>
      <div className="min-w-0">
        <StatusBadge tone={r.enabled ? "ok" : "off"}>{k(`status.${statusKey(r)}`)}</StatusBadge>
      </div>
      <div className="flex flex-wrap justify-end gap-1">
        <Button asChild size="sm" variant="ghost">
          <Link
            to="/processes/$processId"
            params={{ processId: r.flow_id }}
            search={{ company: p.tenantId }}
          >
            {k("open")}
          </Link>
        </Button>
        {a.clone ? (
          <Button
            size="sm"
            variant="outline"
            disabled={p.busy}
            onClick={() => p.onOp({ op: "clone", id: r.id })}
          >
            {k("clone")}
          </Button>
        ) : null}
        {a.publish ? (
          <Button
            size="sm"
            variant="outline"
            disabled={p.busy}
            onClick={() => p.onOp({ op: "publish", id: r.id })}
          >
            {k("publish")}
          </Button>
        ) : null}
        {a.revert ? (
          <Button
            size="sm"
            variant="outline"
            disabled={p.busy}
            onClick={() => p.onOp({ op: "revert", id: r.id })}
          >
            {k("revert")}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          disabled={p.busy}
          aria-pressed={r.enabled}
          onClick={() => p.onOp({ op: "toggle", id: r.id, enabled: !r.enabled })}
        >
          {r.enabled ? k("turnOff") : k("turnOn")}
        </Button>
      </div>
    </li>
  );
}

export function CompanyFlowList({ tenantId, rows }: { tenantId: string; rows: CompanyFlowRow[] }) {
  const { t } = useTranslation();
  const tr = useTr();
  const op = useCompanyFlowOp(tenantId);
  const [err, setErr] = useState<string | null>(null);
  const run = (a: FlowOp) => {
    setErr(null);
    op.mutate(a, {
      onError: (e) => setErr(errorKey(e instanceof ApiError ? e.code : undefined)),
    });
  };
  const onDrop = (from: string, to: string) => {
    const ids = reorderIds(rows, from, to);
    if (ids) run({ op: "order", ids });
  };
  return (
    <div className="space-y-3" data-testid="company-flow-list">
      {err ? (
        <p role="alert" className="text-body text-destructive" data-testid="company-flow-error">
          {t(`tenants.companyFlows.err.${err}`)}
        </p>
      ) : null}
      <div className="rounded-md border border-border">
        <div
          className={`${GRID} px-3 py-2 text-caption font-semibold text-muted-foreground`}
          role="presentation"
        >
          <span />
          <span>{t("tenants.companyFlows.col.name")}</span>
          <span>{t("tenants.companyFlows.col.trigger")}</span>
          <span>{t("tenants.companyFlows.col.source")}</span>
          <span>{t("tenants.companyFlows.col.status")}</span>
          <span />
        </div>
        {groupByApp(rows).map((g) => (
          <section key={g.app} aria-label={tr(`featmeta.app.${g.app}.name`)}>
            <h2 className="m-0 border-t border-border bg-muted/40 px-3 py-2 text-label font-semibold">
              {tr(`featmeta.app.${g.app}.name`)}
            </h2>
            <ul className="m-0 list-none p-0">
              {g.items.map((r) => (
                <Row
                  key={r.id}
                  r={r}
                  tenantId={tenantId}
                  busy={op.isPending}
                  onOp={run}
                  onDrop={onDrop}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="text-caption text-muted-foreground">{t("tenants.companyFlows.orderHint")}</p>
    </div>
  );
}
