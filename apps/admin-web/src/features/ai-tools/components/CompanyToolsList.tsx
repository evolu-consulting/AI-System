// CR-121 R6 · c16 (chuyển từ tab "Quy trình" của công ty, ToolRow): "Công ty dùng" trong ngăn chi tiết — mỗi công ty một công tắc.
import type { AiToolUsage, WorkflowCompany } from "@ai/contracts/workflow-tools";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import type { Translate } from "@/lib/format";
import { useCompanyTools } from "../hooks/use-company-tools";
import { companyTally } from "../lib/ai-tools";
import { ToolOffDialog } from "./ToolOffDialog";

/** "Bật bởi {tên} · {ngày}" khi đang bật; rỗng khi chưa từng bật / đã tắt (`granted_*` null). */
export function grantedLine(t: Translate, row: WorkflowCompany, locale: string): string {
  if (row.granted_at === null || row.granted_by === null) return "";
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    new Date(row.granted_at),
  );
  return t("aiTools.drawer.grantedBy", { name: row.granted_by, date });
}

export function CompanyToolsList({ tool }: { tool: AiToolUsage }) {
  const { t, i18n } = useTranslation();
  const tools = useCompanyTools({ id: tool.workflow_id, name: tool.name });
  const locale = i18n.language === "vi" ? "vi-VN" : "en-GB";
  const items = tools.list.data?.items;
  const tally = items ? companyTally(items) : null;
  return (
    <section aria-label={t("aiTools.drawer.companies")} className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-caption font-semibold text-muted-foreground">
          {t("aiTools.drawer.companies")}
        </h3>
        {tally ? (
          <span className="font-mono text-caption text-muted-foreground" aria-live="polite">
            {t("aiTools.drawer.tally", tally)}
          </span>
        ) : null}
      </div>
      <p className="text-caption text-muted-foreground">{t("aiTools.drawer.companiesDesc")}</p>
      {tool.enabled ? null : (
        <StatusBadge tone="warn" tooltip={t("aiTools.drawer.systemOffTip")}>
          {t("aiTools.drawer.systemOff")}
        </StatusBadge>
      )}
      {tools.list.isPending ? <Skeleton className="h-24 w-full" /> : null}
      {tools.loadError ? (
        <p role="alert" className="text-body text-destructive">
          {t("aiTools.drawer.loadError")}
        </p>
      ) : null}
      {items && items.length === 0 ? (
        <p className="text-body text-muted-foreground">{t("aiTools.drawer.none")}</p>
      ) : null}
      {items && items.length > 0 ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {items.map((c) => (
            <li key={c.tenant_id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium" title={c.name}>
                  {c.name}
                </div>
                <div className="truncate text-caption text-muted-foreground">
                  {grantedLine(t as unknown as Translate, c, locale)}
                </div>
              </div>
              <Switch
                aria-label={t("aiTools.drawer.switchAria", { tool: tool.name, company: c.name })}
                checked={c.on}
                disabled={tools.pendingId === c.tenant_id}
                onCheckedChange={(want) => tools.toggle(c, want)}
              />
            </li>
          ))}
        </ul>
      ) : null}
      <ToolOffDialog
        toolName={tool.name}
        company={tools.off}
        onCancel={tools.cancelOff}
        onConfirm={tools.confirmOff}
      />
    </section>
  );
}
