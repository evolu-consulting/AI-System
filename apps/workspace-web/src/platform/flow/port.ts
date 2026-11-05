// CR-118 · UW-FR-10..15 · cr118-flow-web · cổng FlowRuntime của web gộp (spec §5). UI/hook chỉ biết kiểu này; adapter HTTP của
// route kit hub (`/pack/<k>/flow/...`, sau cờ HUB_FLOW_RUNTIME) ở `adapters/http.ts`. Thân/phản hồi theo `@ai/contracts/flow`.
import type {
  FlowActionRequest,
  FlowActionResult,
  FlowFormValues,
  FlowSummary,
  FlowView,
} from "@ai/contracts/flow";

export interface FlowRuntime {
  /** Trạng thái flow của `ref` tại khe. `null` = khe/ref không có (404) hoặc runtime chưa bật. */
  view(slot: string, ref: string, signal?: AbortSignal): Promise<FlowView | null>;
  /** Hành động của task đang mở (`POST /pack/<k>/flow/:slot/:ref/tasks/:id/actions/:action`). Một đường duy nhất (CR-121 gỡ `legacy-act`). */
  act(
    slot: string,
    ref: string,
    taskId: string,
    action: string,
    body: FlowActionRequest,
  ): Promise<FlowActionResult>;
  /** Người điền gửi form của bước `form` (đường sẵn có `POST /review-tasks/:id/form`; Hub kiểm theo snapshot). */
  submitForm(taskId: string, values: FlowFormValues): Promise<void>;
  /** Huy hiệu danh sách, một lô ≤ 100 ref (một yêu cầu, không N+1). `null` = runtime chưa bật. */
  summary(slot: string, refs: readonly string[], signal?: AbortSignal): Promise<FlowSummary | null>;
}

/** Tên gói của khe `<gói>.<việc>` (phần đầu) — tiền tố route `/pack/<gói>/flow`. */
export const packOfSlot = (slot: string): string => slot.split(".", 1)[0] ?? slot;
