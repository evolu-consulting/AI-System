// CR-122 · P7 · công tắc "Dùng quy trình mới cho công ty này" (cờ flow_triggers) — chỉ platform_admin; bật thì hỏi xác nhận một câu.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useFlowSettings, useSetFlowTriggers } from "../flow-settings-api";

export function FlowSwitch({ tenantId }: { tenantId: string }) {
  const { t } = useTranslation();
  const q = useFlowSettings(tenantId);
  const set = useSetFlowTriggers(tenantId);
  const [ask, setAsk] = useState(false);
  if (!q.data) return null;
  const on = q.data.flow_triggers;
  const blocked = !on && !q.data.has_active_flow; // chưa có quy trình nào đang áp dụng ⇒ bật cũng không có gì để chạy
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
      data-testid="flow-switch"
    >
      <div className="min-w-0">
        <p className="m-0 text-label font-medium">{t("tenants.companyFlows.newFlow.label")}</p>
        <p className="m-0 text-caption text-muted-foreground" data-testid="flow-switch-status">
          {t(`tenants.companyFlows.newFlow.${on ? "on" : "off"}`)}
        </p>
        {blocked ? (
          <p className="m-0 text-caption text-warning" data-testid="flow-switch-reason">
            {t("tenants.companyFlows.newFlow.noFlow")}
          </p>
        ) : null}
      </div>
      <Switch
        checked={on}
        disabled={set.isPending || blocked}
        aria-label={t("tenants.companyFlows.newFlow.label")}
        data-testid="flow-switch-toggle"
        onCheckedChange={(v) => (v ? setAsk(true) : set.mutate(false))}
      />
      <AlertDialog open={ask} onOpenChange={setAsk}>
        <AlertDialogContent data-testid="flow-switch-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("tenants.companyFlows.newFlow.label")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("tenants.companyFlows.newFlow.confirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("tenants.companyFlows.newFlow.cancel")}</AlertDialogCancel>
            <Button
              data-testid="flow-switch-confirm-ok"
              onClick={() => {
                set.mutate(true);
                setAsk(false);
              }}
            >
              {t("tenants.companyFlows.newFlow.ok")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
