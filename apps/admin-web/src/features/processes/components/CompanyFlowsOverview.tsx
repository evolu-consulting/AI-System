// CR-127 · M1 (mock Main.dc) · tab «Theo công ty»: mọi quy trình của các công ty — Quy trình · Công ty · Trạng thái. Bấm hàng ⇒ màn soạn.
// Hub chỉ có danh sách THEO công ty ⇒ mỗi công ty một truy vấn (số công ty nhỏ); chỉ quản trị nền tảng dùng.
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTenantPacks } from "@/features/tenants/api";
import { useCompanyFlowList } from "@/features/tenants/flows/company-flows-api";
import { CreateFlowDialog } from "@/features/tenants/flows/components/CreateFlowDialog";
import { useAssignableTenants } from "../hooks/use-assignable-tenants";
import { DeleteDraftFlow } from "./DeleteDraftFlow";

function Rows({ tid, name }: { tid: string; name: string }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const q = useCompanyFlowList(tid);
  return (
    <>
      {(q.data?.items ?? []).map((f) => (
        <tr
          key={f.id}
          className="cursor-pointer border-t border-border hover:bg-muted"
          data-testid="company-flow-row"
        >
          <td className="px-3 py-2">
            <button
              type="button"
              className="text-left font-medium underline-offset-2 hover:underline"
              onClick={() =>
                void navigate({
                  to: "/processes/$processId",
                  params: { processId: f.flow_id },
                  search: { company: tid },
                })
              }
            >
              {f.name}
            </button>
          </td>
          <td className="px-3 py-2">{name}</td>
          <td className="px-3 py-2">
            <Badge variant={f.enabled ? "ok" : "outline"}>
              {t(f.enabled ? "process.admin.byCompany.on" : "process.admin.byCompany.draft")}
            </Badge>
          </td>
          <td className="px-3 py-2 tabular-nums">
            {f.updated_at ? new Date(f.updated_at).toLocaleDateString(i18n.language) : "—"}
          </td>
          <td className="px-3 py-2 text-right">
            <DeleteDraftFlow tenantId={tid} flow={f} />
          </td>
        </tr>
      ))}
    </>
  );
}

/** Sổ Hợp Tác đã bật mà chưa có quy trình duyệt đang áp dụng (sự kiện «Gửi duyệt hợp đồng») ⇒ nhân viên chưa gửi duyệt được. */
function MissingApproval({ tid, name }: { tid: string; name: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const packs = useTenantPacks(tid, true);
  const flows = useCompanyFlowList(tid);
  const on = (packs.data?.items ?? []).some((p) => p.key === "contracts" && p.enabled);
  const has = (flows.data?.items ?? []).some(
    (f) => f.trigger_event === "contract.submitted" && f.enabled,
  );
  if (!on || !flows.isSuccess || has) return null;
  return (
    <Alert role="alert" className="bg-warning-bg" data-testid="no-approval-flow">
      <AlertDescription className="flex flex-wrap items-center gap-3">
        {t("process.admin.byCompany.noApproval", { company: name })}
        <Button size="sm" onClick={() => setOpen(true)}>
          {t("process.admin.byCompany.create")}
        </Button>
      </AlertDescription>
      <CreateFlowDialog tenantId={tid} tenantName={name} open={open} onOpenChange={setOpen} />
    </Alert>
  );
}

export function CompanyFlowsOverview() {
  const { t } = useTranslation();
  const tenants = useAssignableTenants(true);
  return (
    <div className="space-y-3">
      {tenants.items.map((c) => (
        <MissingApproval key={c.id} tid={c.id} name={c.name} />
      ))}
      <div className="overflow-x-auto rounded-md border border-border" data-testid="by-company">
        <table className="w-full text-body">
          <thead className="text-caption uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">{t("process.admin.byCompany.flow")}</th>
              <th className="px-3 py-2 text-left">{t("process.admin.byCompany.company")}</th>
              <th className="px-3 py-2 text-left">{t("process.admin.byCompany.status")}</th>
              <th className="px-3 py-2 text-left">{t("process.admin.byCompany.updated")}</th>
              <th className="w-24 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {tenants.items.map((c) => (
              <Rows key={c.id} tid={c.id} name={c.name} />
            ))}
          </tbody>
        </table>
        <p className="px-3 py-2 text-caption text-muted-foreground">
          {t("process.admin.byCompany.hint")}
        </p>
      </div>
    </div>
  );
}
