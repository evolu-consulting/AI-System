// CR-103 · fnr-canvas: vị trí node trên canvas — trường CHỈ-UI của giai đoạn (engine / luật def bỏ qua).
// Chỉ lưu `y` (px, trục dọc tự do); `x` luôn suy ra từ bước (cột). Vắng ở snapshot cũ ⇒ canvas dùng bố cục tự động.
import { z } from "zod";

/** Biên `y` hợp lệ (px) — đủ rộng cho 10 giai đoạn + nhánh, chặn số rác. */
export const STAGE_UI_Y = { min: -5_000, max: 20_000 } as const;

export const StageUiSchema = z.strictObject({
  y: z.number().finite().min(STAGE_UI_Y.min).max(STAGE_UI_Y.max),
});
export type StageUi = z.infer<typeof StageUiSchema>;
