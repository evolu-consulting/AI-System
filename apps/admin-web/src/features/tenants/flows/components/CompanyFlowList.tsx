// CR-122 · U2 · FLOW2-FR-05..09/20: MỘT danh sách flow của công ty (thay SlotRouting/RoutingRules/DrawerAssign): nhóm theo app; mỗi dòng
// = tên · Bắt đầu khi · nguồn · trạng thái + lý do · hành động. Kéo thả đổi thứ tự (chỉ có nghĩa cho sự kiện quyết định).
import type { CompanyFlowRow } from "@ai/contracts/hub-admin";
import { Link } from "@tanstack/react-router";
import { GripVertical, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { eventOf, eventsOfApp } from "@/features/processes/lib/flow-def";
import { joinRecordWords } from "@/features/processes/lib/record-words";
import { useSession } from "@/lib/auth/use-session";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { type FlowOp, useCompanyFlowOp } from "../company-flows-api";
import {
  actionsOf,
  errorKey,
  groupByApp,
  menuOf,
  reorderIds,
  splitRows,
  statusKey,
} from "../lib/company-flow-view";
import { canSeeFlowSwitch } from "../lib/flow-switch-access";
import { AssignFlow } from "./AssignFlow";
import { CopyDialog } from "./CopyDialog";
import { FlowSwitch } from "./FlowSwitch";

/** Cùng lưới cho tiêu đề và mọi dòng ⇒ cột thẳng mép. */
const GRID =
  "grid grid-cols-[1.5rem_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)_19rem] items-center gap-3";

function triggerText(r: CompanyFlowRow, cond: string): string {
  const ev = eventsOfApp(r.app).find((e) => e.key === r.trigger_event);
  return `${ev?.label ?? r.trigger_event}${r.has_condition ? ` · ${cond}` : ""}`;
}

/** CR-125 · x7 · menu "…" của dòng: Quay về bản gốc · Tắt/Bật (Sao chép để sửa là nút riêng vì là lối vào sửa). */
function RowMenu(p: { r: CompanyFlowRow; busy: boolean; onOp: (a: FlowOp) => void }) {
  const { t } = useTranslation();
  const m = menuOf(p.r);
  if (!m.revert && !m.toggle) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          disabled={p.busy}
          aria-label={t("tenants.companyFlows.more")}
          data-testid="company-flow-more"
        >
          <MoreHorizontal aria-hidden className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {m.revert ? (
          <DropdownMenuItem onSelect={() => p.onOp({ op: "revert", id: p.r.id })}>
            {t("tenants.companyFlows.revert")}
          </DropdownMenuItem>
        ) : null}
        {m.toggle ? (
          <DropdownMenuItem
            onSelect={() => p.onOp({ op: "toggle", id: p.r.id, enabled: m.toggle === "on" })}
          >
            {t(m.toggle === "on" ? "tenants.companyFlows.turnOn" : "tenants.companyFlows.turnOff")}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Row(p: {
  r: CompanyFlowRow;
  tenantId: string;
  busy: boolean;
  /** Mục "Nâng cao: thứ tự" đang mở ⇒ mới cho kéo thả. */
  ordering: boolean;
  /** CR-125 · x7 · dòng trong mục "Mẫu thư viện" (bản gốc đã được thay): chỉ "Mở". */
  compact?: boolean;
  onOp: (a: FlowOp) => void;
  onDrop: (fromId: string, toId: string) => void;
  /** CR-125 · c5b · "Sao chép để sửa" mở hộp nói trước mẫu dùng được chưa. */
  onCopy?: (r: CompanyFlowRow) => void;
}) {
  const { t } = useTranslation();
  const k = (s: string, o?: Record<string, unknown>) => t(`tenants.companyFlows.${s}`, o);
  const { r } = p;
  const a = actionsOf(r);
  return (
    <li
      className={`${GRID} border-t border-border px-3 py-2`}
      draggable={p.ordering}
      data-testid={`company-flow-${r.flow_key}`}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", r.id)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => p.onDrop(e.dataTransfer.getData("text/plain"), r.id)}
    >
      {p.ordering ? (
        <GripVertical aria-hidden className="size-4 cursor-grab text-muted-foreground" />
      ) : (
        <span />
      )}
      <div className="min-w-0">
        <p className="m-0 truncate text-body font-medium">{r.name}</p>
        {r.warnings.map((w) => (
          <p key={w} className="m-0 text-caption text-warning">
            {k(w === "group_missing" ? "warn.groupMissing" : "warn.shadowed")}
          </p>
        ))}
      </div>
      <p className="m-0 min-w-0 truncate text-body">{triggerText(r, k("withCondition"))}</p>
      <p className="m-0 min-w-0 truncate text-body text-muted-foreground">
        {r.source
          ? k("source.copy", { name: r.source.name || r.name, v: r.source.version })
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
        {a.clone && !p.compact ? (
          <Button
            size="sm"
            variant="outline"
            disabled={p.busy}
            onClick={() => (p.onCopy ? p.onCopy(r) : p.onOp({ op: "clone", id: r.id }))}
          >
            {k("clone")}
          </Button>
        ) : null}
        {p.compact ? null : <RowMenu r={r} busy={p.busy} onOp={p.onOp} />}
      </div>
    </li>
  );
}

export function CompanyFlowList({ tenantId, rows }: { tenantId: string; rows: CompanyFlowRow[] }) {
  const { t, i18n } = useTranslation();
  const tr = useTr();
  const op = useCompanyFlowOp(tenantId);
  // CR-125 · c6 · B4: hộp xác nhận bật gọi đúng tên bản ghi của các flow công ty có (community ⇒ "bài đăng"), không cứng "hợp đồng"
  const words = joinRecordWords(
    // hàng không có sự kiện biết được (flow cũ theo khe) KHÔNG được kéo chữ "hợp đồng" vào câu của app khác (community)
    rows.flatMap((r) => {
      const label = eventOf(r.app, r.trigger_event)?.record?.label;
      return label ? [label] : [];
    }),
    i18n.language === "vi" ? "vi" : "en",
  );
  const role = useSession((s) => s.me?.role);
  const isPlatform = role === "platform_admin";
  const [err, setErr] = useState<string | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [copying, setCopying] = useState<CompanyFlowRow | null>(null);
  const { main, templates } = splitRows(rows);
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
      {copying ? (
        <CopyDialog
          tenantId={tenantId}
          flowId={copying.flow_id}
          name={copying.name}
          isPlatform={isPlatform}
          onClose={() => setCopying(null)}
          onConfirm={() => run({ op: "clone", id: copying.id })}
        />
      ) : null}
      {canSeeFlowSwitch(role) ? <FlowSwitch tenantId={tenantId} words={words} /> : null}
      {isPlatform ? (
        <AssignFlow
          tenantId={tenantId}
          assignedFlowIds={new Set(rows.map((r) => r.flow_id))}
          busy={op.isPending}
          onAssign={(flowId) => run({ op: "assign", flowId })}
        />
      ) : null}
      {rows.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("tenants.companyFlows.empty")}</p>
      ) : null}
      {err ? (
        <p role="alert" className="text-body text-destructive" data-testid="company-flow-error">
          {t(`tenants.companyFlows.err.${err}`)}
        </p>
      ) : null}
      <div className={`rounded-md border border-border ${rows.length === 0 ? "hidden" : ""}`}>
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
        {groupByApp(main).map((g) => (
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
                  ordering={ordering}
                  onOp={run}
                  onDrop={onDrop}
                  onCopy={setCopying}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {templates.length > 0 ? (
        <details
          className="rounded-md border border-border px-3 py-2"
          data-testid="company-flow-templates"
        >
          <summary className="cursor-pointer text-label font-medium">
            {t("tenants.companyFlows.templates", { n: templates.length })}
          </summary>
          <p className="mt-2 text-caption text-muted-foreground">
            {t("tenants.companyFlows.templatesHint")}
          </p>
          <ul className="m-0 mt-2 list-none rounded-md border border-border p-0">
            {templates.map((r) => (
              <Row
                key={r.id}
                r={r}
                compact
                tenantId={tenantId}
                busy={op.isPending}
                ordering={false}
                onOp={run}
                onDrop={onDrop}
              />
            ))}
          </ul>
        </details>
      ) : null}
      <details
        className="rounded-md border border-border px-3 py-2"
        data-testid="company-flow-order"
        onToggle={(e) => setOrdering((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-label font-medium">
          {t("tenants.companyFlows.orderTitle")}
        </summary>
        <p className="mt-2 text-caption text-muted-foreground">
          {t("tenants.companyFlows.orderHint")}
        </p>
      </details>
    </div>
  );
}
