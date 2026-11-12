// CR-105 · UX: ô "Trạng thái" và "Tenant đang dùng" của danh sách thư viện — chữ dễ đọc thay cho số; tên tenant tải lười, rút gọn có tooltip.
import { useTranslation } from "react-i18next";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { type ListRow, statusOf } from "../../lib/library-list";
import { libraryConditions, stepsDisplay } from "../../lib/step-chips";
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
  // Ngắn: "—" khi chưa ai dùng; viên "Mặc định" (cùng viên với mọi nơi) khi là mặc định của việc.
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {count > 0 ? (
        <span>{t("process.admin.library.usage.count", { n: count })}</span>
      ) : row.is_default ? null : (
        <span className="text-muted-foreground" title={t("process.admin.library.usage.none")}>
          —
        </span>
      )}
      {row.is_default ? <DefaultPill slotLabel={row.slot_label ?? ""} /> : null}
      {/* CR-127 · U2 · M8: gỡ nhãn «Mẫu cũ — không sao chép được» */}
    </span>
  );
}

/** Viên "Mặc định" dùng chung (tên Thư viện / cột Dùng bởi / danh sách khác): tooltip nói mặc định của việc nào. */
export function DefaultPill({ slotLabel, short = true }: { slotLabel: string; short?: boolean }) {
  const { t } = useTranslation();
  return (
    <span title={t("process.admin.library.defaultBadge", { slot: slotLabel })}>
      <StatusBadge tone="ok">
        {short
          ? t("process.admin.library.defaultTag")
          : t("process.admin.library.defaultBadge", { slot: slotLabel })}
      </StatusBadge>
    </span>
  );
}
/** "Các bước": chip TÊN bước (≤ 4 + "+N") và nhãn điều kiện; chưa có dữ liệu bước ⇒ số bước. */
export function StepsCell({ row }: { row: ListRow }) {
  const d = stepsDisplay(row);
  const conds = libraryConditions(row);
  // Một kiểu cho cột: có tên ⇒ chip; không có tên ⇒ viên "N bước" (không số trơn).
  if (d.kind !== "chips") return <StepChips steps={null} count={d.kind === "count" ? d.n : 0} />;
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <StepChips steps={d.chips} />
      {conds.map((c) => (
        <span key={c} className="truncate text-caption text-muted-foreground" title={c}>
          {c}
        </span>
      ))}
    </span>
  );
}
