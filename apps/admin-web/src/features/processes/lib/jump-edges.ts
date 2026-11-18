// CR-123 · p25 · cạnh "nhảy bước": nguồn DUY NHẤT nay ở `@ai/flow-canvas/pure` (CR-184: Sổ Hợp Tác vẽ CÙNG đồ thị); giữ cửa cũ cho nơi dùng và test.
import { applyJumps } from "@ai/flow-canvas/pure";

export type JumpStage = Parameters<typeof applyJumps>[0][number];
export { applyJumps };
