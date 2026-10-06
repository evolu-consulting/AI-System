// X1-AC06 · HUB-FR-94 · nối `delta` vào chữ đang stream (thuần): hiển thị ngay từng mảnh, không chờ `step.finished`.
// `run.finished.content` vẫn THAY chữ đã ghép (nguồn đúng duy nhất, xem `reducer.ts`).
import type { DeltaData } from "@ai/contracts/chat";
import type { RunState } from "./reducer";

export function applyDelta(state: RunState, delta: Pick<DeltaData, "text">): RunState {
  return { ...state, text: state.text + delta.text };
}
