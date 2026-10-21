// GAP-D2 · #25: huỷ một việc đã ghi KÈM LÝ DO (bắt buộc ở màn hình) — dùng chung cho "Đã ghi gần đây" (PartnerLog) và danh sách
// việc góp điểm của tiêu chí (CriterionJobs, mọi loại việc). Xong ⇒ làm mới mọi truy vấn `partners` (điểm tính lại).
import { useTranslation } from "react-i18next";
import { promptDialog } from "~/components/shared/dialog-bus";
import { type Act, useAct } from "../lib/use-act";
import { useLedgerWrites } from "./use-ledger";

/** Hỏi lý do rồi huỷ qua `act` (đã có sẵn trạng thái bận/lỗi của khối gọi). */
export function useAskVoid(act: Act) {
  const { t } = useTranslation();
  const { voidEvent } = useLedgerWrites();
  const L = (k: string, o?: Record<string, unknown>) => t(`contracts.ledger.${k}`, o);
  return async (id: string, what: string, date: string): Promise<boolean> => {
    const reason = await promptDialog({
      title: L("voidTitle"),
      body: L("voidBody", { what, date }),
      label: L("voidReason"),
      placeholder: L("voidReasonPh"),
      confirmLabel: L("voidConfirm"),
      required: true,
      maxLength: 500,
    });
    if (!reason) return false;
    return act(`void:${id}`, () => voidEvent(id, reason), L("toast.voided"));
  };
}

/** Bản độc lập (có `act` riêng) cho nơi không có sẵn khối ghi việc. */
export function useVoidJob() {
  const a = useAct();
  return { ask: useAskVoid(a.act), err: a.err, busy: a.busy };
}
