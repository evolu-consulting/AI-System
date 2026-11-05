// CR-120 · sửa LUẬT chọn quy trình của một khe ngay trong trang Quy trình (cùng bộ sửa `RoutingRules` với khối Quy trình ở trang công
// của platform). API cho phép tenant_admin sửa luật của chính công ty; gán / bỏ gán nội dung quy trình vẫn chỉ platform.
import { useTranslation } from "react-i18next";
import { useFlowDepartments, useTenantRouting } from "@/features/tenants/api-routing";
import { RoutingRules } from "@/features/tenants/components/slots/RoutingRules";

export default function RulesPanel(p: { tid: string; slot: string; isPlatform: boolean }) {
  const { t } = useTranslation();
  const q = useTenantRouting(p.tid, p.slot, true);
  const depts = useFlowDepartments(p.tid, p.isPlatform, true);
  if (q.isError)
    return (
      <p role="alert" className="text-body text-destructive">
        {t("tenants.slots.routing.loadFail")}
      </p>
    );
  if (!q.data)
    return <p className="text-body text-muted-foreground">{t("process.admin.flows.loading")}</p>;
  return (
    <div data-testid={`flows-rules-${p.slot}`}>
      <RoutingRules
        key={q.data.version}
        tenantId={p.tid}
        slot={p.slot}
        data={q.data}
        departments={depts.data ?? []}
        onReload={() => void q.refetch()}
      />
    </div>
  );
}
