// HUB-FR-129 · P-c2 §1.3 · nhãn/số liệu thuần của khối kết quả Áp. Bản chép: admin-web `features/processes/lib/apply-view.ts` (TECH-DEBT FC11).
import type { ApplyStageView, AutofixStageView, StageView } from "@ai/contracts/chat";

type ErrCode = NonNullable<ApplyStageView["error_code"]>;
/** Exhaustive theo contract (thêm mã ⇒ typecheck đỏ tới khi thêm câu). */
const ERR_CODES: Record<ErrCode, true> = {
  auth: true,
  no_credential: true,
  push_rejected: true,
  network: true,
  rate_limited: true,
  provider_error: true,
  check_failed: true,
  unsupported_provider: true,
};

/** 7 ký tự đầu của sha; `null` ⇒ `null`. */
export const sha7 = (sha: string | null): string | null => (sha ? sha.slice(0, 7) : null);

/** FC12 · chỉ `https://` mới thành liên kết (server đã kiểm host PC2-R15; client kiểm lại phòng thủ). */
export function prLinkOk(a: Pick<ApplyStageView, "pr_url">): a is { pr_url: string } {
  const u = a.pr_url;
  if (!u?.startsWith("https://")) return false;
  try {
    return new URL(u).protocol === "https:";
  } catch {
    return false;
  }
}

/** Câu lỗi `error_code` ⇒ khoá i18n; mã lạ/vắng ⇒ câu chung (FC14). */
export function applyErrKey(code: string | null | undefined): string {
  return code && Object.hasOwn(ERR_CODES, code)
    ? `process.common.apply.err.${code}`
    : "process.common.apply.genericErr";
}

/** Kết quả Áp của stage `idx` (nếu không có ⇒ stage Áp mới nhất của run). */
export function applyOf(
  stages: readonly Pick<StageView, "idx" | "apply">[],
  idx?: number,
): ApplyStageView | undefined {
  const own = idx === undefined ? undefined : stages.find((s) => s.idx === idx)?.apply;
  if (own) return own;
  for (let i = stages.length - 1; i >= 0; i--) {
    const a = stages[i]?.apply;
    if (a) return a;
  }
  return undefined;
}

/** FC13 · khoá câu gate "Đạt sẽ…" theo `apply_mode` + `apply_base`; không có dòng ⇒ `null`. */
export function gateLineKey(
  v: Pick<AutofixStageView, "apply_mode" | "apply_base"> | undefined,
): "pr" | "auto_merge" | "branch_only" | "local" | null {
  const mode = v?.apply_mode ?? null;
  const base = v?.apply_base ?? null;
  if (mode === null) return null;
  if (mode === "branch_only") return base === null ? "local" : "branch_only";
  return base === null ? null : mode;
}
