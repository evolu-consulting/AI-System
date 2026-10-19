// HUB-FR-107 · HUB-FR-109 · HUB-BR-28 · R-G01…R-G03, R-G05 · luật thuần cổng kiểm + gợi ý quy trình (plan-contract §7
// "runs/start + gates (PF1)"). Thuần: không I/O. `suggestProcesses` dùng chung `levenshtein` (commands/suggest.rules).
import type { StageRunStatus } from "@ai/contracts/chat";
import { levenshtein } from "../../commands/suggest.rules";

/**
 * HUB-FR-109 · R-G01/R-G02 · "Hành động thật" chỉ được chạy khi stage ngay trước là **cổng duyệt đã Đạt** (review +
 * `done`): người duyệt đã cho phép ⇒ Hub chèn sẵn `tool_confirmations` (D4). Không có stage trước / stage trước `auto` /
 * chưa `done` (vd `waiting_review`) ⇒ false (tool sẽ hỏi lại ⇒ CONFIRMATION_REQUIRED).
 */
export function realActionAllowed(
  prev: { after: "review" | "auto"; status: StageRunStatus } | null,
): boolean {
  return prev !== null && prev.after === "review" && prev.status === "done";
}

/** HUB-FR-107 · R-G03 · "Chưa đạt" và N2-FR-02 "Từ chối" bắt buộc góp ý/lý do (trim ≠ rỗng); "Đạt" không cần. */
export function reviewDecisionCheck(b: {
  result: "pass" | "fail" | "reject";
  feedback?: string;
}): "ok" | "FEEDBACK_REQUIRED" {
  if (b.result === "pass") return "ok";
  return b.feedback && b.feedback.trim().length > 0 ? "ok" : "FEEDBACK_REQUIRED";
}

const SUGGEST_MAX = 3;
/**
 * HUB-BR-28 · R-G05 · key gần `typed` (≤ 3, sắp theo khoảng cách rồi tên). Ngưỡng `max(2, ⌊len/2⌋)`. `typed` rỗng ⇒ [].
 * (Bản sao thuần của `runs.repo.suggestProcesses` để lộ cho luật — `.rules.ts` không được import `.repo.ts`, T-DEP-3.)
 */
export function suggestProcesses(typed: string, keys: readonly string[]): string[] {
  const t = typed.toLowerCase().normalize("NFC");
  if (t === "") return [];
  const limit = Math.max(2, Math.floor([...t].length / 2));
  return keys
    .map((k) => ({ k, d: levenshtein(t, k) }))
    .filter((x) => x.d <= limit)
    .sort((a, b) => a.d - b.d || (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
    .slice(0, SUGGEST_MAX)
    .map((x) => x.k);
}
