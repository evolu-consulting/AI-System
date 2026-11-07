// CR-103 · fnr-canvas: vị trí node trên canvas — trường CHỈ-UI của giai đoạn (engine / luật def bỏ qua).
// `y` (px) + `x` (tuỳ chọn, u13) chỉ có khi người dùng kéo node tay (cần cả hai mới tính là vị trí tay). Vắng ⇒ canvas dùng bố cục tự động (ELK).
// CR-125 · x9: `dir` = hướng bố cục của CẢ flow (Ngang / Dọc), cùng chỗ với vị trí tay (MỘT nơi lưu `ui`); ghi trên mọi giai đoạn, đọc từ giai đoạn đầu có `dir`.
import { z } from "zod";

/** Biên `y` hợp lệ (px) — đủ rộng cho 10 giai đoạn + nhánh, chặn số rác. */
export const STAGE_UI_Y = { min: -5_000, max: 20_000 } as const;

/** Hướng bố cục sơ đồ: `RIGHT` = Ngang (trái → phải), `DOWN` = Dọc (trên → dưới). */
export const LAYOUT_DIRS = ["RIGHT", "DOWN"] as const;
export type LayoutDir = (typeof LAYOUT_DIRS)[number];

export const StageUiSchema = z
  .strictObject({
    y: z.number().finite().min(STAGE_UI_Y.min).max(STAGE_UI_Y.max).optional(),
    /** CR-123 · u13 · bố cục ELK: vị trí ngang khi người dùng kéo tay (cùng biên với y); vắng ⇒ node theo bố cục tự động. */
    x: z.number().finite().min(STAGE_UI_Y.min).max(STAGE_UI_Y.max).optional(),
    dir: z.enum(LAYOUT_DIRS).optional(),
  })
  .refine((u) => u.y !== undefined || u.dir !== undefined, {
    message: "ui cần y (vị trí kéo tay) hoặc dir (hướng bố cục)",
  });
export type StageUi = z.infer<typeof StageUiSchema>;
