// CR-120 · khối "Quy trình" DUY NHẤT trong thẻ app của công ty (trang công ty + ngăn "Công ty" của trang app): mỗi khe: quy trình đã gán,
// luật chọn theo phòng ban, "Mặc định" là một dòng. CR-121 D-4 · KHÔNG còn công tắc "Duyệt theo quy trình": gán quy trình xong là chạy
// (không có thao tác ẩn bắt buộc). Bỏ ô chọn/Gán/Về mặc định kiểu cũ. Chỉ platform_admin.
import { useTranslation } from "react-i18next";
import { slotsOfApp } from "@/features/apps/lib/app-config";
import { useTenantSlotBlock } from "../../hooks/use-tenant-slots";
import { SlotRouting } from "./SlotRouting";

/**
 * Chỉ hiện các khe của `app` (tiền tố `<app>.`); không có khe ⇒ không hiện gì. Cả trang công ty và ngăn "Công ty" của
 * trang app dùng chung đúng component + hook này (một đường gán).
 */
export function TenantProcessSlots({
  tenant,
  app,
}: {
  tenant: { id: string; name: string };
  app: string;
}) {
  const { t } = useTranslation();
  const b = useTenantSlotBlock(tenant);
  const rows = b.hidden ? [] : slotsOfApp(b.slots.data ?? [], app);
  if (rows.length === 0 && !b.slots.isError) return null;
  return (
    <section
      className="space-y-3 border-t border-border pt-3"
      aria-label={t("tenants.slots.title")}
      data-testid={`tenant-processes-${app}`}
    >
      <div className="min-w-0">
        <h4 className="text-label font-semibold">{t("tenants.slots.title")}</h4>
        <p className="text-caption text-muted-foreground">{t("tenants.slots.desc")}</p>
      </div>
      {b.slots.isError ? (
        <p role="alert" className="text-body text-destructive">
          {t("tenants.slots.loadFail")}
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.slot}
              className="space-y-2 rounded-md border border-border p-3"
              data-testid={`tenant-slot-${r.slot}`}
            >
              <span className="text-label font-medium">{r.label}</span>
              <SlotRouting tenantId={tenant.id} slot={r.slot} candidates={b.candidates(r.slot)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
