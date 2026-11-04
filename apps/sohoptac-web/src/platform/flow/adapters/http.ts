// CR-118 · cr118-flow-web · adapter HTTP của `FlowRuntime` cho route flow chung của kit hub (`/pack/<k>/flow/...`). Bearer + refresh
// do web-kit lo. Cờ `HUB_FLOW_RUNTIME` tắt ⇒ route không gắn ⇒ 404: `view`/`summary` trả null và `summary` nhớ trong phiên để
// không bắn lại yêu cầu 404 mỗi lần tải danh sách.
import type { FlowActionResult, FlowSummary, FlowView } from "@ai/contracts/flow";
import { ApiError, api } from "@ai/web-kit/http";
import { type FlowRuntime, packOfSlot } from "../port";

const enc = encodeURIComponent;
const base = (slot: string) => `/pack/${enc(packOfSlot(slot))}/flow`;
const missing = (e: unknown): boolean => e instanceof ApiError && e.status === 404;

export function httpFlowRuntime(): FlowRuntime {
  /** Khe đã báo 404 ở `summary` (runtime chưa bật) — bỏ qua tới hết phiên trang. */
  const off = new Set<string>();
  return {
    async view(slot, ref, signal) {
      try {
        return await api<FlowView>(`${base(slot)}/${enc(slot)}/${enc(ref)}`, { signal });
      } catch (e) {
        if (missing(e)) return null;
        throw e;
      }
    },
    act(slot, ref, taskId, action, body) {
      return api<FlowActionResult>(
        `${base(slot)}/${enc(slot)}/${enc(ref)}/tasks/${enc(taskId)}/actions/${enc(action)}`,
        { method: "POST", body },
      );
    },
    async submitForm(taskId, values) {
      await api<unknown>(`/review-tasks/${enc(taskId)}/form`, { method: "POST", body: { values } });
    },
    async summary(slot, refs, signal) {
      if (off.has(slot) || refs.length === 0) return null;
      try {
        return await api<FlowSummary>(`${base(slot)}/${enc(slot)}/summary`, {
          method: "POST",
          body: { refs },
          signal,
        });
      } catch (e) {
        if (!missing(e)) throw e;
        off.add(slot);
        return null;
      }
    },
  };
}

/** Runtime dùng chung của ứng dụng (tests truyền runtime giả qua props/hook). */
export const flowRuntime: FlowRuntime = httpFlowRuntime();
