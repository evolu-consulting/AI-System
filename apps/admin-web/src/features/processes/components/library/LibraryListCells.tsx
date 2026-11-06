// CR-105 · UX: ô "Trạng thái" và "Tenant đang dùng" của danh sách thư viện — chữ dễ đọc thay cho số; tên tenant tải lười, rút gọn có tooltip.
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { type ListRow, statusOf } from "../../lib/library-list";
import { libraryChips, libraryConditions } from "../../lib/step-chips";
import { StepChips } from "../StepChips";

export function StatusCell({ row }: { row: ListRow }) {
  const { t } = useTranslation();
  const s = statusOf(row);
  if (row.enabled === false)
    return (
      <span className="flex flex-col gap-0.5">
        <StatusBadge tone="off">{t("process.admin.library.status.off")}</StatusBadge>
        <span className="text-caption text-muted-foreground">
          {t("process.admin.library.status.offWhy")}
        </span>
      </span>
    );
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

/** CR-121 c15 · "Dùng bởi": số công ty đang dùng (đếm sẵn từ danh sách — không gọi thêm theo hàng); 0 ⇒ "Chưa công ty nào dùng". */
export function UsedByCell({ row }: { row: ListRow }) {
  const { t } = useTranslation();
  const count = row.tenant_count ?? 0;
  if (count === 0)
    return (
      <span className="text-muted-foreground">
        {t("process.admin.library.usage.none")}
        {row.is_default ? ` · ${t("process.admin.library.usage.default")}` : ""}
      </span>
    );
  return (
    <span title={row.is_default ? t("process.admin.library.usage.default") : undefined}>
      {t("process.admin.library.usage.count", { n: count })}
    </span>
  );
}

/** "Các bước": chip TÊN bước (≤ 4 + "+N") và nhãn điều kiện; chưa có dữ liệu bước ⇒ số bước. */
export function StepsCell({ row }: { row: ListRow }) {
  const chips = libraryChips(row);
  const conds = libraryConditions(row);
  if (chips.length === 0) return <span className="text-muted-foreground">{row.stage_count}</span>;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <StepChips steps={chips} />
      {conds.map((c) => (
        <span key={c} className="truncate text-caption text-muted-foreground" title={c}>
          {c}
        </span>
      ))}
    </span>
  );
}
