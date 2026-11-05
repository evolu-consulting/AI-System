// CR-120 · khối "Quy trình" DUY NHẤT trong thẻ app của công ty (trang công ty + ngăn "Công ty" của trang app): công tắc "Duyệt theo quy trình"
// (feature `contracts-approval-engine`) + mỗi khe: quy trình đã gán, luật chọn theo phòng ban, "Mặc định" là một dòng. Bỏ ô chọn/Gán/Về mặc
// định kiểu cũ (API gán cũ còn một bản phát hành, do lát cr120-single-source biến thành bản dẫn xuất). Chỉ platform_admin.
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { slotsOfApp } from "@/features/apps/lib/app-config";
import { useTenantSlotBlock } from "../../hooks/use-tenant-slots";
import type { EngineToggle } from "../../lib/engine-toggle";
import { SlotRouting } from "./SlotRouting";

/**
 * Chỉ hiện các khe của `app` (tiền tố `<app>.`); không có khe và không có công tắc ⇒ không hiện gì. Cả trang công ty và ngăn "Công ty" của
 * trang app dùng chung đúng component + hook này (một đường gán).
 */
export function TenantProcessSlots({
  tenant,
  app,
  engine = null,
}: {
  tenant: { id: string; name: string };
  app: string;
  engine?: EngineToggle | null;
}) {
  const { t } = useTranslation();
  const b = useTenantSlotBlock(tenant);
  const rows = b.hidden ? [] : slotsOfApp(b.slots.data ?? [], app);
  if (rows.length === 0 && !b.slots.isError && !engine) return null;
  return (
    <section
      className="space-y-3 border-t border-border pt-3"
      aria-label={t("tenants.slots.title")}
      data-testid={`tenant-processes-${app}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="text-label font-semibold">{t("tenants.slots.title")}</h4>
          <p className="text-caption text-muted-foreground">{t("tenants.slots.desc")}</p>
        </div>
        {engine ? (
          <span className="flex items-center gap-2 text-body font-medium">
            {t("tenants.slots.engine")}
            <Switch
              data-testid="tenant-engine-switch"
              checked={engine.on}
              disabled={engine.disabled}
              aria-label={t("tenants.slots.engine")}
              onCheckedChange={engine.onChange}
            />
          </span>
        ) : null}
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
              <SlotRouting
                tenantId={tenant.id}
                slot={r.slot}
                candidates={b.candidates(r.slot)}
                engineOff={engine ? !engine.on : false}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
