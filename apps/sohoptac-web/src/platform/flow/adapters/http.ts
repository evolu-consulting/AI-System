// CR-118 · cr118-flow-web · adapter HTTP của `FlowRuntime` cho route flow chung của kit hub (`/pack/<k>/flow/...`). Bearer + refresh
// do web-kit lo. Cờ `HUB_FLOW_RUNTIME` tắt ⇒ route không gắn ⇒ 404: cờ báo qua `/pack/me.flags` nên `view`/`summary` trả null mà
// KHÔNG gửi yêu cầu (không 404 ở console).
import type { FlowActionResult, FlowSummary, FlowView } from "@ai/contracts/flow";
import { ApiError, api } from "@ai/web-kit/http";
import { type FlowRuntime, packOfSlot } from "../port";

const enc = encodeURIComponent;
const base = (slot: string) => `/pack/${enc(packOfSlot(slot))}/flow`;
const missing = (e: unknown): boolean => e instanceof ApiError && e.status === 404;

/** Cờ `flow.runtime` của `/pack/me.flags` (ảnh đã nạp ⇒ không thêm yêu cầu mạng). Động để không kéo gate vào chunk của flow. */
const runtimeOn = (): Promise<boolean> =>
  import("~/platform/features").then((m) => m.featureFlag("flow.runtime"));

/** `on` = runtime flow có bật không (`/pack/me`); tắt ⇒ `view`/`summary` trả null, không gửi yêu cầu. 404 vẫn được nuốt. */
export function httpFlowRuntime(on: () => Promise<boolean> = async () => true): FlowRuntime {
  return {
    async view(slot, ref, signal) {
      if (!(await on())) return null;
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
      if (refs.length === 0 || !(await on())) return null;
      return api<FlowSummary>(`${base(slot)}/${enc(slot)}/summary`, {
        method: "POST",
        body: { refs },
        signal,
      }).catch((e: unknown) => {
        if (missing(e)) return null;
        throw e;
      });
    },
  };
}

/** Runtime dùng chung của ứng dụng (tests truyền runtime giả qua props/hook). */
export const flowRuntime: FlowRuntime = httpFlowRuntime(runtimeOn);
