// HD-FR-36 · S05: dữ liệu + thao tác thẻ duyệt. "Xác nhận" như mgmt-app (`ContractPage.tsx:71-85`): lưu ô đã đổi TRƯỚC rồi mới
// quyết; xong ⇒ tải lại HĐ + trạng thái duyệt. Bước đang chạy (AI đọc / tool) ⇒ tải lại mỗi 2 s tới khi có bước người.
// confirm-flow: một thao tác tại một thời điểm (chặn bấm đúp kể cả trước khi nút kịp vô hiệu); `act` trả kết quả có mã lỗi.
// CR-120: Duyệt/Trả lại/Từ chối (+ lý do, + SP gắn) đi `FlowRuntime.act` khe `contracts.approval`; FlowView tự tải lại khi thẻ đổi (`ApprovalTimeline`).
import type { ApprovalActionRequest } from "@ai/contracts/pack-contracts";
import { ApiError } from "@ai/web-kit/http";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { flowRuntime } from "~/platform/flow";
import {
  approvalKey,
  cancelReopenApproval,
  fetchApproval,
  reopenApproval,
  retryApproval,
} from "../api";
import { advanceDelay } from "../lib/advance-wait";
import { type ActResult, flowActionOf } from "../lib/approval";
import { approvalErrorText } from "../lib/approval-error";
import { engineAdvancing } from "../lib/engine-card";
import { APPROVAL_SLOT } from "../lib/flow-view";
import { useApprovalPush } from "./use-approval-push";

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
  const tries = useRef(0);
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: approvalKey(id) }),
      qc.invalidateQueries({ queryKey: contractKey }),
      qc.invalidateQueries({ queryKey: ["contracts", "list"] }),
    ]);
  const q = useQuery({
    queryKey: approvalKey(id),
    queryFn: ({ signal }) => fetchApproval(id, signal),
    // CR-107: có `attention` ⇒ KHÔNG poll. Chuyển bước engine ⇒ push `/me/stream` + lưới an toàn giãn dần tới 30 s rồi giữ.
    refetchInterval: (s) => {
      const d = s.state.data;
      if (d?.attention || (!RUNNING.has(d?.step ?? "") && !engineAdvancing(d))) {
        tries.current = 0;
        return false;
      }
      if (RUNNING.has(d?.step ?? "")) return REFRESH_MS;
      tries.current += 1;
      return advanceDelay(tries.current - 1);
    },
  });
  useApprovalPush(q.data, () => void refresh());
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const inFlight = useRef(false);
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
        // CR-120: hành động đi FlowRuntime.act (task đang mở của thẻ); một đường duy nhất (CR-121 gỡ `legacy-act`).
        const out = await flowRuntime.act(
          APPROVAL_SLOT,
          id,
          q.data?.task_id ?? "",
          body.action,
          flowActionOf(body),
        );
        setMsg(t(label ?? DONE_KEY[body.action]));
        await refresh();
        return { ok: true, step: out.view.phase };
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
  /** Xử lý run kẹt (owner/admin): mở lại / Thử lại / Huỷ & mở lại. Lỗi ⇒ câu lỗi theo mã, không ném. */
  const recover = (call: (id: string) => Promise<unknown>, doneKey: string) => async () =>
    (await once("redo", async () => {
      try {
        await call(id);
        setMsg(t(doneKey));
        await refresh();
        return true;
      } catch (e) {
        setErr(approvalErrorText(e, t));
        // 409 (không còn chờ quyết) / 422 (thẻ đã đổi lý do): tải lại để banner khớp trạng thái thật.
        await refresh();
        return false;
      }
    })) ?? false;
  const reopen = recover(reopenApproval, "contracts.approval.engine.reopened");
  const retry = recover(retryApproval, "contracts.approval.engine.retried");
  const cancelReopen = recover(cancelReopenApproval, "contracts.approval.engine.reopened");
  return {
    approval: q.data,
    busy,
    msg,
    setMsg,
    err,
    setErr,
    act,
    prepare,
    refresh,
    reopen,
    retry,
    cancelReopen,
  };
}
