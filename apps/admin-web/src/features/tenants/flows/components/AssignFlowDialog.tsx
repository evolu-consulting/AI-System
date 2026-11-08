// CR-125 · S1 · H3 · "Gán" quy trình NGAY trong wizard onboard (không thoát sang tab Quy trình): hộp chọn mẫu Thư viện + kiểm "dùng được
// ở công ty chưa" (AssignFlow), gán xong thì đóng và danh sách "Cần xử lý" tự làm mới.
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompanyFlowList, useCompanyFlowOp } from "../company-flows-api";
import { AssignFlow } from "./AssignFlow";

type Props = { tenantId: string; open: boolean; onOpenChange: (open: boolean) => void };

export function AssignFlowDialog({ tenantId, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const list = useCompanyFlowList(tenantId, open);
  const op = useCompanyFlowOp(tenantId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("tenants.companyFlows.assign.dialogTitle")}</DialogTitle>
          <DialogDescription>{t("tenants.companyFlows.assign.dialogHint")}</DialogDescription>
        </DialogHeader>
        <AssignFlow
          tenantId={tenantId}
          assignedFlowIds={new Set((list.data?.items ?? []).map((r) => r.flow_id))}
          busy={op.isPending}
          onAssign={(flowId) =>
            op.mutate({ op: "assign", flowId }, { onSuccess: () => onOpenChange(false) })
          }
        />
      </DialogContent>
    </Dialog>
  );
}
