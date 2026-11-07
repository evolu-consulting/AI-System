// CR-125 · x9 · hướng bố cục sơ đồ (Ngang / Dọc): MỘT nguồn lưu là `ui.dir` của giai đoạn (cùng chỗ với vị trí kéo tay `ui.x/ui.y`).
// Thuần: đọc hướng hiệu lực từ bản nháp (mặc định Ngang, Dọc khi màn hẹp), đổi hướng = ghi `uiDir` vào mọi giai đoạn + xoá vị trí tay
// (vị trí của hướng cũ không dùng được ở hướng mới) trong MỘT bước hoàn tác.
import type { LayoutDir } from "@ai/contracts/hub-admin";
import type { StageDraft } from "./draft-types";

/** Màn hẹp hơn mức này (px) mặc định bố cục Dọc. */
export const NARROW_PX = 1100;

export const isNarrowScreen = (): boolean =>
  typeof window !== "undefined" && window.innerWidth < NARROW_PX;

/** Hướng đang dùng: giá trị đã lưu (giai đoạn đầu có `uiDir`), vắng ⇒ mặc định theo độ rộng màn hình. */
export function layoutDirOf(
  stages: readonly Pick<StageDraft, "uiDir">[],
  narrow: boolean = isNarrowScreen(),
): LayoutDir {
  return stages.find((s) => s.uiDir !== undefined)?.uiDir ?? (narrow ? "DOWN" : "RIGHT");
}

/** Đổi hướng: mọi giai đoạn mang `uiDir` mới và mất vị trí tay (bố cục lại theo ELK). */
export function withLayoutDir<T extends StageDraft>(stages: readonly T[], dir: LayoutDir): T[] {
  return stages.map(({ uiX: _x, uiY: _y, ...s }) => ({ ...s, uiDir: dir }) as unknown as T);
}
