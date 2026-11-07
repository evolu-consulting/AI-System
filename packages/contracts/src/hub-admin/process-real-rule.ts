// CR-123 · u4 · FLOW3 §Luật hợp lệ: MỘT luật cho picker (chèn / thêm), kéo thả (thả, dời, dán), nối lại và lưu (REAL_ACTION của Hub):
// bước hành động thật (Ký số…) chỉ hợp lệ khi MỌI stage của bước liền trước là bước duyệt (`after = review`). Thuần, không I/O.
export type RealRuleStage = { step: number; after: string };
export type RealRuleNode = RealRuleStage & { uid: string; real: boolean };

/** Bật được "Hành động thật" ở stage `i` không: bước ≥ 1 và mọi stage của bước liền trước là review. */
export function realActionAllowed(stages: readonly RealRuleStage[], i: number): boolean {
  const step = stages[i]?.step ?? 0;
  if (step < 1) return false;
  return stages.filter((s) => s.step === step - 1).every((s) => s.after === "review");
}

/**
 * Sau phép `after`, stage hành động thật NÀO vừa trở nên không hợp lệ so với `before` ⇒ trả uid; không có ⇒ null.
 * Stage đã sai từ trước (snapshot cũ) không chặn phép khác.
 */
export function newRealViolation(
  before: readonly RealRuleNode[],
  after: readonly RealRuleNode[],
): string | null {
  const bad = (xs: readonly RealRuleNode[]) =>
    new Set(xs.filter((s, i) => s.real && !realActionAllowed(xs, i)).map((s) => s.uid));
  const was = bad(before);
  for (const uid of bad(after)) if (!was.has(uid)) return uid;
  return null;
}
