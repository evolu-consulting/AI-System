// CR-103 · fnr-canvas: vị trí node trên canvas — trường CHỈ-UI của giai đoạn (engine / luật def bỏ qua).
// `y` (px) + `x` (tuỳ chọn, u13) chỉ có khi người dùng kéo node tay (cần cả hai mới tính là vị trí tay). Vắng ⇒ canvas dùng bố cục tự động (ELK).
import { z } from "zod";

/** Biên `y` hợp lệ (px) — đủ rộng cho 10 giai đoạn + nhánh, chặn số rác. */
export const STAGE_UI_Y = { min: -5_000, max: 20_000 } as const;

export const StageUiSchema = z.strictObject({
  y: z.number().finite().min(STAGE_UI_Y.min).max(STAGE_UI_Y.max),
  /** CR-123 · u13 · bố cục ELK: vị trí ngang khi người dùng kéo tay (cùng biên với y); vắng ⇒ node theo bố cục tự động. */
  x: z.number().finite().min(STAGE_UI_Y.min).max(STAGE_UI_Y.max).optional(),
});
export type StageUi = z.infer<typeof StageUiSchema>;
