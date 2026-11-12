// CR-127 · Z7 · «Xoá» quy trình NHÁP của công ty (chưa áp dụng, chưa có lượt chạy) — một nút + hộp xác nhận dùng chung cho trang Quy trình theo
// công ty và màn soạn. Hub quyết định (`deletable`); đã áp dụng/có lượt chạy ⇒ không hiện nút (Tắt thay). Chỉ quản trị nền tảng.
import type { CompanyFlowRow } from "@ai/contracts/hub-admin";
import { notifyError, notifySuccess } from "@ai/web-kit/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { companyFlowsKey } from "@/features/tenants/flows/company-flows-api";
import { deleteDef, useInvalidateDefs } from "../api";
import { processErrorSpec } from "../lib/errors";

type Props = {
  tenantId: string;
  flow: Pick<CompanyFlowRow, "flow_id" | "name" | "def_version" | "deletable">;
  /** Gọi sau khi xoá xong (vd rời màn soạn). */
  onDeleted?: () => void;
};

export function DeleteDraftFlow({ tenantId, flow, onDeleted }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const invalidateDefs = useInvalidateDefs();
  const [open, setOpen] = useState(false);
  if (!flow.deletable) return null;
  const confirm = async () => {
    try {
      await deleteDef(flow.flow_id, flow.def_version, tenantId);
    } catch (err) {
      const spec = processErrorSpec(err);
      notifyError(t(spec.key, spec.params));
      void qc.invalidateQueries({ queryKey: companyFlowsKey(tenantId) }); // 409: hàng đã đổi (đã áp dụng/có lượt) ⇒ nút tự biến mất
      throw err;
    }
    notifySuccess(t("process.admin.list.toast.deleted"));
    void qc.invalidateQueries({ queryKey: companyFlowsKey(tenantId) });
    void invalidateDefs();
    onDeleted?.();
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive"
        onClick={() => setOpen(true)}
        data-testid="delete-draft-flow"
      >
        {t("process.admin.byCompany.delete")}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        title={t("process.admin.byCompany.deleteTitle", { name: flow.name })}
        description={t("process.admin.byCompany.deleteBody")}
        confirmLabel={t("process.admin.byCompany.deleteConfirm")}
        onConfirm={confirm}
      />
    </>
  );
}
