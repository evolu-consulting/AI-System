// ADM-FR-32 · M3-R07, R08 · lưu ma trận qua MỘT batch; lỗi: không áp một phần, giữ nháp, làm mới ma trận (D10).
import { useTranslation } from "react-i18next";
import { notifyError, notifyInfo, notifySuccess } from "@/components/shared/toast";
import { describeError } from "@/lib/errors";
import { ApiError } from "@/lib/http";
import { useTr } from "@/lib/use-translate";
import { useSaveMatrix } from "../api";
import { type Draft, draftToBatch, type MatrixModel } from "../lib/matrix";

type Args = {
  tenantId: string | undefined;
  model: MatrixModel | null;
  refetch: () => void;
  onSaved: () => void;
};

export function useMatrixSave({ tenantId, model, refetch, onSaved }: Args) {
  const { t } = useTranslation();
  const tr = useTr();
  const save = useSaveMatrix(tenantId);
  const submit = async (draft: Draft) => {
    if (!model) return;
    try {
      const res = await save.mutateAsync(draftToBatch(model, draft));
      notifySuccess(t("access.toast.saved", { added: res.added, removed: res.removed }));
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === "UNAUTHORIZED") return;
      const spec = describeError(err, { coreProtected: "access.error.coreProtected" });
      // NOT_ENTITLED: ma trận tự tải lại (hàng chuyển sang khoá) nên chỉ là thông báo, không phải lỗi bền (D10).
      const notice = err instanceof ApiError && err.code === "NOT_ENTITLED";
      (notice ? notifyInfo : notifyError)(tr(spec.key, spec.params));
      refetch();
    }
  };
  return { submit, pending: save.isPending };
}
