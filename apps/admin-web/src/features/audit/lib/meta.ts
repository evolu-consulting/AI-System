// ADM-FR-51 · dòng phụ của chi tiết: "{dd/MM/yyyy HH:mm} · v{n} · {tenant | Toàn hệ thống}".
import type { AuditItem } from "@ai/contracts";
import type { Translate } from "@/lib/format";
import { formatClock } from "@/lib/format";

const pad = (n: number) => String(n).padStart(2, "0");

export function auditMeta(item: AuditItem, t: Translate): string {
  const d = new Date(item.at);
  const time = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${formatClock(d)}`;
  const scope = item.tenant_key ?? t("audit.scope.system");
  const n = item.entity_version ?? item.config_version;
  return n === null
    ? t("audit.detail.metaNoVersion", { time, scope })
    : t("audit.detail.meta", { time, n, scope });
}
