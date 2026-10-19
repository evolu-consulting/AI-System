// HD-FR-36 · S05: dữ liệu + thao tác thẻ duyệt. "Xác nhận" như mgmt-app (`ContractPage.tsx:71-85`): lưu ô đã đổi TRƯỚC rồi mới
// quyết; xong ⇒ tải lại HĐ + trạng thái duyệt. Bước đang chạy (AI đọc / tool) ⇒ tải lại mỗi 2 s tới khi có bước người.
import type { ApprovalActionRequest } from "@ai/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { actApproval, approvalKey, fetchApproval } from "../api";
import { approvalErrorText } from "../lib/approval-error";

const RUNNING = new Set(["extract", "value", "finalize"]);
const REFRESH_MS = 2000;
export type Busy = ApprovalActionRequest["action"] | null;

const DONE_KEY: Record<ApprovalActionRequest["action"], string> = {
  approve: "contracts.approval.done.approve",
  reject: "contracts.approval.done.reject",
  redo: "contracts.approval.done.redo",
};

export function useApproval(id: string, contractKey: readonly unknown[]) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: approvalKey(id),
    queryFn: ({ signal }) => fetchApproval(id, signal),
    refetchInterval: (s) => (RUNNING.has(s.state.data?.step ?? "") ? REFRESH_MS : false),
  });
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** `before` (vd lưu ô đã đổi) chạy trước khi quyết; lỗi ở bất kỳ bước nào ⇒ câu lỗi, không ném. */
  const act = async (body: ApprovalActionRequest, before?: () => Promise<void>, label?: string) => {
    setErr(null);
    setMsg(null);
    setBusy(body.action);
    try {
      await before?.();
      await actApproval(id, body);
      setMsg(t(label ?? DONE_KEY[body.action]));
      await Promise.all([
        qc.invalidateQueries({ queryKey: approvalKey(id) }),
        qc.invalidateQueries({ queryKey: contractKey }),
      ]);
      return true;
    } catch (e) {
      setErr(approvalErrorText(e, t));
      return false;
    } finally {
      setBusy(null);
    }
  };
  return { approval: q.data, busy, msg, err, act };
}
