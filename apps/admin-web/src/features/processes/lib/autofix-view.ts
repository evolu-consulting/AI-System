// HUB-FR-119 · P-c1 · nhãn/số liệu thuần của khối kết quả tự sửa. Bản chép: chat-web `shared/lib/autofix-view.ts` (TECH-DEBT).
import type { AutofixStageView, StageView } from "@ai/contracts/chat";

/** Thứ tự nhóm lỗi hiển thị (plan-frontend §1.3). */
export const FAILURE_GROUP_ORDER = [
  "paths",
  "size",
  "secrets",
  "tests",
  "install",
  "apply_patch",
] as const;
export type FailureGroup = (typeof FAILURE_GROUP_ORDER)[number];

/** 7 ký tự đầu của `pin_sha`; không phải git (`null`) ⇒ `null`. */
/** Kết quả tự-sửa của stage `idx` nếu thuộc vòng hiện tại (`round` khớp); khác vòng ⇒ undefined. */
export function currentAutofix(
  stages: readonly Pick<StageView, "idx" | "round" | "autofix">[],
  idx: number,
): AutofixStageView | undefined {
  const s = stages.find((x) => x.idx === idx);
  return s?.autofix && s.autofix.round === s.round ? s.autofix : undefined;
}

export const sha7 = (sha: string | null): string | null => (sha ? sha.slice(0, 7) : null);

/** `nguồn@sha7` (không git ⇒ chỉ `nguồn`). */
export const sourceLabel = (v: Pick<AutofixStageView, "source_key" | "pin_sha">): string => {
  const s = sha7(v.pin_sha);
  return s ? `${v.source_key}@${s}` : v.source_key;
};

/** Rút gọn nhánh `ai/9f3c1a2b…/fix` ⇒ `ai/9f3c…/fix` (đoạn giữa dài > 4 ký tự bị cắt còn 4 + "…"). */
export function shortBranch(branch: string): string {
  const parts = branch.split("/");
  if (parts.length < 3) return branch;
  return parts
    .map((p, i) => (i > 0 && i < parts.length - 1 && p.length > 4 ? `${p.slice(0, 4)}…` : p))
    .join("/");
}

/** `+i −d` (dấu trừ U+2212). */
export const diffStatLabel = (s: { insertions: number; deletions: number }): string =>
  `+${s.insertions} −${s.deletions}`;

/** Giây từ ms, 1 chữ số thập phân theo ngôn ngữ (12,4 / 12.4). */
export const secondsLabel = (ms: number, lang: string): string =>
  new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
    Math.round(ms / 100) / 10,
  );

/** Nhóm lỗi có mặt, theo thứ tự cố định, không trùng. */
export function failureGroups(v: Pick<AutofixStageView, "failures">): FailureGroup[] {
  const have = new Set(v.failures.map((f) => f.check));
  return FAILURE_GROUP_ORDER.filter((g) => have.has(g));
}

/** Nhóm đầu tiên (cho "Kiểm không đạt · <nhóm>"); không có lỗi ⇒ `null`. */
export const firstFailureGroup = (v: Pick<AutofixStageView, "failures">): FailureGroup | null =>
  failureGroups(v)[0] ?? null;

/** Tóm tắt trạng thái kiểm gần nhất để chọn câu: ok ⇒ testOk; no_changes ⇒ noChanges; check_failed ⇒ checkFailed.short. */
export type LastCheck =
  | { kind: "ok"; seconds: string }
  | { kind: "no_changes" }
  | { kind: "check_failed"; group: FailureGroup | null };

export function lastCheck(v: AutofixStageView, lang: string): LastCheck {
  if (v.status === "no_changes") return { kind: "no_changes" };
  if (v.status === "check_failed") return { kind: "check_failed", group: firstFailureGroup(v) };
  return { kind: "ok", seconds: secondsLabel(v.test?.duration_ms ?? 0, lang) };
}

/** Dòng bí mật: không bao giờ hiện `detail` (FC6). */
export const isSecretFailure = (f: { check: string }): boolean => f.check === "secrets";
