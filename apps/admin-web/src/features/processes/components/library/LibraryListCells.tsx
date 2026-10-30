// CR-105 · UX: ô "Trạng thái" và "Tenant đang dùng" của danh sách thư viện — chữ dễ đọc thay cho số; tên tenant tải lười, rút gọn có tooltip.
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { type ListRow, statusOf, tenantsSummary } from "../../lib/library-list";
import { useAssignments } from "../../library-api";

export function StatusCell({ row }: { row: ListRow }) {
  const { t } = useTranslation();
  const s = statusOf(row);
  if (s.kind === "draft")
    return <StatusBadge tone="off">{t("process.admin.library.status.draft")}</StatusBadge>;
  if (s.kind === "changed")
    return (
      <StatusBadge tone="warn">
        {t("process.admin.library.status.changed", { n: s.version })}
      </StatusBadge>
    );
  return (
    <StatusBadge tone="ok">
      {t("process.admin.library.status.published", { n: s.version })}
    </StatusBadge>
  );
}

/** "Mặc định cho mọi tenant chưa gán" · "<n> tenant: A, B… (+k)" · "Chưa gán". */
export function TenantsCell({ row }: { row: ListRow }) {
  const { t } = useTranslation();
  const count = row.tenant_count ?? 0;
  const q = useAssignments(row.id, count > 0);
  const all = (q.data ?? []).map((a) => a.tenant_name);
  const s = tenantsSummary(row, all);
  if (s.kind === "none")
    return <span className="text-muted-foreground">{t("process.admin.library.usage.none")}</span>;
  const list = s.names.join(", ") + (s.extra > 0 ? ` +${s.extra}` : "");
  const assigned =
    list === ""
      ? t("process.admin.library.usage.count", { n: count })
      : t("process.admin.library.usage.named", { n: count, names: list });
  const text = s.kind === "default" ? t("process.admin.library.usage.default") : assigned;
  return (
    <span
      className="block max-w-72 truncate"
      title={
        s.kind === "default"
          ? `${text}${count > 0 ? ` · ${assigned}` : ""}`
          : all.join(", ") || text
      }
    >
      {text}
    </span>
  );
}
