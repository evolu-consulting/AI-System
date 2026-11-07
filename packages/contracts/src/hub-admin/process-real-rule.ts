// CR-123 · u4 · FLOW3 §Luật hợp lệ: MỘT luật cho picker (chèn / thêm), kéo thả (thả, dời, dán), nối lại và lưu (REAL_ACTION của Hub):
// bước hành động thật chỉ hợp lệ khi MỌI stage của bước liền trước là bước duyệt (`after = review`). Thuần, không I/O.
// CR-125 · m5 · luật KHÔNG còn cứng theo "Ký số": node khai `requires: { before: "approval" }` ở `MODULES` (modules/*/node.ts) và luật đọc từ đó.
// Stage không mang node (tool gọi thẳng, bước Áp…) hoặc node lạ giữ mặc định cũ = đòi người duyệt ngay trước; node có khai báo mà
// không có `requires` ⇒ không đòi gì.
import { MODULES } from "../modules/index.generated";
import { featureNodeByKey } from "../modules/modules.rules";

/** `node` = khoá node của stage (`stage.node`); vắng ⇒ không xác định ⇒ mặc định đòi người duyệt. */
export type RealRuleStage = { step: number; after: string; node?: string | undefined };
export type RealRuleNode = RealRuleStage & { uid: string; real: boolean };

/** Stage thuộc node `node` có phải có người duyệt ngay trước khi làm hành động thật không (đọc `requires` từ `MODULES`). */
export function requiresApprovalBefore(node: string | undefined): boolean {
  const decl = node ? featureNodeByKey(MODULES, node) : undefined;
  return decl ? decl.requires?.before === "approval" : true;
}

/** Bật được "Hành động thật" ở stage `i` không: node không đòi gì ⇒ được; ngược lại bước ≥ 1 và mọi stage của bước liền trước là review. */
export function realActionAllowed(stages: readonly RealRuleStage[], i: number): boolean {
  if (!requiresApprovalBefore(stages[i]?.node)) return true;
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
