// X1-AC06 · HUB-FR-94 · nối `delta` vào chữ đang stream (thuần): hiển thị ngay từng mảnh, không chờ `step.finished`.
// `run.finished.content` vẫn THAY chữ đã ghép (nguồn đúng duy nhất, xem `reducer.ts`).
import type { DeltaData } from "@ai/contracts/chat";

// Kiểu tổng quát theo `text` (không import `RunState` từ `reducer.ts` ⇒ không vòng phụ thuộc).
export function applyDelta<S extends { text: string }>(
  state: S,
  delta: Pick<DeltaData, "text">,
): S {
  return { ...state, text: state.text + delta.text };
}
