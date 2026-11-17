// CR-181 · sự kiện React từ portal (menu chuột phải) vẫn chuyền lên sân khấu: chỉ xử lý khi đích nằm trong DOM của sân khấu.
export function isInsideStage(
  stage: { contains(n: unknown): boolean } | null,
  target: unknown,
): boolean {
  return !!stage && target != null && stage.contains(target);
}
