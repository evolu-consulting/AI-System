// CR-121 D-3: lỗi xuất bản từ Hub (422 `PROCESS_PUBLISH_INVALID` / `SLOT_BODY_INVALID`, D-2) → dòng hiển thị trên thanh trạng thái.
// Dạng chuẩn `details.issues[] = {step, field, fix, path, rule}`; thiếu `step` ⇒ suy từ `path` (`…steps.N…` hoặc `stages.N…`, đếm từ 0).
import { PUBLISH_ISSUE_CODES, PUBLISH_ISSUE_KEY } from "@ai/contracts/pack-contracts";
import { ApiError } from "@/lib/http";
import type { LibStep } from "./flow-form";
import { splitRule } from "./library-view";

export type PublishIssue = {
  /** Chỉ số bước (đếm từ 0) hoặc null khi lỗi chung của quy trình. */
  index: number | null;
  field: string | null;
  /** Câu sửa hiển thị cho người dùng (có thể rỗng ⇒ dùng mã luật). */
  text: string;
  rule: string;
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const PATH_STEP = /(?:^|\.)(?:steps|stages)\.(\d+)(?:\.([a-z_]+))?/;

function indexOf(raw: Record<string, unknown>, steps: readonly LibStep[]): number | null {
  const s = raw.step;
  if (typeof s === "number") return Number.isInteger(s) && s >= 0 ? s : null;
  if (typeof s === "string") {
    const byKey = steps.findIndex((x) => x.key === s);
    if (byKey >= 0) return byKey;
    if (/^\d+$/.test(s)) return Number(s);
  }
  const m = typeof raw.path === "string" ? PATH_STEP.exec(raw.path) : null;
  return m?.[1] !== undefined ? Number(m[1]) : null;
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Đọc `details.issues` (hoặc `{issues}` thô) thành danh sách lỗi; mục hỏng bị bỏ qua. Hub chỉ trả mã + biến: câu do `t` dịch. */
export function parsePublishIssues(
  details: unknown,
  steps: readonly LibStep[],
  t: Translate,
): PublishIssue[] {
  const list: unknown[] = isObj(details) && Array.isArray(details.issues) ? details.issues : [];
  return list.filter(isObj).map((raw) => toIssue(raw, steps, t));
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Câu của MỘT mã: khoá `PUBLISH_ISSUE_KEY.<mã>` + biến Hub trả (mã lạ ⇒ câu chung kèm luật). */
function messageOf(raw: Record<string, unknown>, rule: string, t: Translate): string {
  const code = str(raw.code) || splitRule(rule).code;
  const params = isObj(raw.params) ? (raw.params as Record<string, string | number>) : {};
  return PUBLISH_ISSUE_CODES.includes(code)
    ? t(`${PUBLISH_ISSUE_KEY}.${code}`, params)
    : t(`${PUBLISH_ISSUE_KEY}.unknown`, { rule });
}

function toIssue(
  raw: Record<string, unknown>,
  steps: readonly LibStep[],
  t: Translate,
): PublishIssue {
  const rule = str(raw.rule);
  const path = str(raw.path);
  const field = str(raw.field) || PATH_STEP.exec(path)?.[2] || null;
  const index = indexOf(raw, steps);
  const msg = rule ? messageOf(raw, rule, t) : path;
  const text =
    index === null ? msg : t("process.admin.library.form.stepIssue", { n: index + 1, msg });
  return { index, field, text, rule };
}

export const publishIssuesOf = (
  err: unknown,
  steps: readonly LibStep[],
  t: Translate,
): PublishIssue[] => (err instanceof ApiError ? parsePublishIssues(err.details, steps, t) : []);
