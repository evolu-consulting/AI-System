// HD-FR-36 · S05: dữ liệu + thao tác thẻ duyệt. "Xác nhận" như mgmt-app (`ContractPage.tsx:71-85`): lưu ô đã đổi TRƯỚC rồi mới
// quyết; xong ⇒ tải lại HĐ + trạng thái duyệt. Bước đang chạy (AI đọc / tool) ⇒ tải lại mỗi 2 s tới khi có bước người.
// confirm-flow: một thao tác tại một thời điểm (chặn bấm đúp kể cả trước khi nút kịp vô hiệu); `act` trả kết quả có mã lỗi.
import type { ApprovalActionRequest, ContractApproval } from "@ai/contracts";
import { ApiError } from "@ai/web-kit/http";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { actApproval, approvalKey, fetchApproval } from "../api";
import type { ActResult } from "../lib/approval";
import { approvalErrorText } from "../lib/approval-error";

const RUNNING = new Set(["extract", "value", "finalize"]);
const REFRESH_MS = 2000;
export type Busy = ApprovalActionRequest["action"] | null;

const DONE_KEY: Record<ApprovalActionRequest["action"], string> = {
  approve: "contracts.approval.done.approve",
  reject: "contracts.approval.done.reject",
  redo: "contracts.approval.done.redo",
  return: "contracts.approval.done.return",
};

const codeOf = (e: unknown): string | null => (e instanceof ApiError ? (e.code as string) : null);

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
  const inFlight = useRef(false);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: approvalKey(id) }),
      qc.invalidateQueries({ queryKey: contractKey }),
      qc.invalidateQueries({ queryKey: ["contracts", "list"] }),
    ]);
  /** Chạy `f` khi không có thao tác nào đang chạy (bấm đúp ⇒ bỏ qua, trả null). */
  const once = async <T>(action: NonNullable<Busy>, f: () => Promise<T>): Promise<T | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setErr(null);
    setMsg(null);
    setBusy(action);
    try {
      return await f();
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  };
  /** `before` (vd lưu ô đã đổi) chạy trước khi quyết; lỗi ở bất kỳ bước nào ⇒ câu lỗi, không ném. */
  const act = async (
    body: ApprovalActionRequest,
    before?: () => Promise<void>,
    label?: string,
  ): Promise<ActResult> =>
    (await once(body.action, async (): Promise<ActResult> => {
      try {
        await before?.();
        const out: ContractApproval = await actApproval(id, body);
        setMsg(t(label ?? DONE_KEY[body.action]));
        await refresh();
        return { ok: true, step: out?.step ?? null };
      } catch (e) {
        setErr(approvalErrorText(e, t));
        return { ok: false, code: codeOf(e) };
      }
    })) ?? { ok: false, code: "IN_FLIGHT" };
  /** products-confirm: việc chuẩn bị trước "Xác nhận" (lưu ô đã đổi, tải dòng HĐ cho hộp gắn SP); lỗi ⇒ câu lỗi, trả null. */
  const prepare = <T>(f: () => Promise<T>): Promise<T | null> =>
    once("approve", async () => {
      try {
        return await f();
      } catch (e) {
        setErr(approvalErrorText(e, t));
        return null;
      }
    });
  return { approval: q.data, busy, msg, setMsg, err, setErr, act, prepare, refresh };
}
