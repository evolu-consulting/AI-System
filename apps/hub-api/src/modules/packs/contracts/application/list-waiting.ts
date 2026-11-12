// CR-127 K2a-1 · BR-05 · spec §4.1 (`GET /contracts` → `waiting`): cột "Đang chờ" của danh sách — bước hiện tại, người (tên người ký khi là
// bước Ký số) và hạn. Thuần: suy từ CÙNG `stepsViewMany` đã gọi MỘT lô cho cả trang (nhãn `step_label`) ⇒ không thêm câu SQL, không N+1.
// Chỉ HĐ đang chờ một bước (`waiting_step` / `waiting_sign`); soạn lại / đã xong / huỷ / lỗi ⇒ null (UI giữ nhãn trạng thái).
import type { StepState } from "../domain/approval-step-label.rules";

export type Waiting = { step: string | null; who: string | null; due_at: string | null };
export type WaitingView = {
  steps: readonly {
    idx: number;
    name: string;
    status: string;
    due_at: string | null;
    module?: { outcome: string; signer?: string } | undefined;
  }[];
};
/** Một phần tử của lô theo trang: nhãn bước + đang chờ (cùng một lượt đọc). */
export type StepInfo = { label: StepState | null; waiting: Waiting | null };

const OPEN = new Set(["open", "running"]);

export function waitingOf(
  v: WaitingView | null | undefined,
  label: Pick<StepState, "code"> | null,
): Waiting | null {
  if (!v || (label?.code !== "waiting_step" && label?.code !== "waiting_sign")) return null;
  const cur = v.steps.find((s) => OPEN.has(s.status) || s.module?.outcome === "waiting");
  if (!cur) return null;
  const who = cur.module?.signer?.trim();
  return { step: cur.name || null, who: who ? who : null, due_at: cur.due_at };
}
