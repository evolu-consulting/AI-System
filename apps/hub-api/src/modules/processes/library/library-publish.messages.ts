// CR-121 D-2 · CR-125 G1 · lỗi kiểm khi xuất bản / gán quy trình thư viện: Hub chỉ trả MÃ + BIẾN, không có câu chữ nào.
// Mỗi vi phạm `{path, rule}` của khe ⇒ `{step, field, code, params}`: `step` đánh số từ 1 như màn hình sửa quy trình; web dịch bằng
// MỘT khoá i18n mỗi mã (`PUBLISH_ISSUE_KEY.<code>`, xem `packages/contracts/.../publish-issue-codes.ts`). Thuần, không I/O.
import { publishIssueParams } from "@ai/contracts/pack-contracts";
import type { PublishIssue } from "./library-publish.rules";

export type IssueParams = Record<string, string | number>;
export type ExplainedIssue = PublishIssue & {
  /** Bước (từ 1) bị lỗi; null ⇒ lỗi chung của quy trình. */
  step: number | null;
  /** Trường của bước (vd `when`, `department_group_id`); null ⇒ cả bước/quy trình. */
  field: string | null;
  /** Mã lỗi (phần của `rule` trước dấu `:`); khoá câu = `PUBLISH_ISSUE_KEY.<code>`. */
  code: string;
  /** Biến nội suy của câu (giới hạn, tên trường/nút/mã phòng ban, công ty). */
  params: IssueParams;
};

/** `steps.2.when` ⇒ bước 3, trường `when`; `stages.3.slot.when` (stage 1 = rẽ hệ thống) ⇒ bước 3. */
function locate(path: string): { step: number | null; field: string | null } {
  const s = /^steps\.(\d+)(?:\.(.+))?$/.exec(path);
  if (s) return { step: Number(s[1]) + 1, field: s[2] ?? null };
  const g = /^stages\.(\d+)(?:\.slot\.(.+))?$/.exec(path);
  if (g) {
    const j = Number(g[1]);
    return { step: j === 0 ? 1 : j, field: g[2] ?? null };
  }
  return { step: null, field: null };
}

export function explainIssue(i: PublishIssue): ExplainedIssue {
  const [code = i.rule, arg = ""] = i.rule.split(/:(.*)/s);
  const { step, field } = locate(i.path);
  return { ...i, step, field, code, params: publishIssueParams(code, arg) };
}

export const explainIssues = (xs: readonly PublishIssue[]): ExplainedIssue[] =>
  xs.map(explainIssue);

/** Gán: mã phòng ban `key` không có ở công ty `tenant` ⇒ một mã cho mỗi bước dùng mã (hoặc lỗi chung nếu không tìm ra bước). */
export function missingGroupIssues(
  body: unknown,
  tenant: string,
  keys: readonly string[],
): ExplainedIssue[] {
  const steps =
    typeof body === "object" && body !== null && Array.isArray((body as { steps?: unknown }).steps)
      ? ((body as { steps: unknown[] }).steps as unknown[])
      : [];
  return keys.flatMap((k) => {
    const hit = steps.flatMap((s, i) => (usesKey(s, k) ? [i] : []));
    const idx = hit.length ? hit : [null];
    return idx.map((i) => ({
      path: i === null ? "steps" : `steps.${i}`,
      rule: "GROUP_MISSING_IN_TENANT",
      step: i === null ? null : i + 1,
      field: "department_group_key",
      code: "GROUP_MISSING_IN_TENANT",
      params: { key: k, tenant },
    }));
  });
}

const usesKey = (x: unknown, k: string): boolean =>
  x === k ||
  (Array.isArray(x) && x.some((v) => usesKey(v, k))) ||
  (typeof x === "object" &&
    x !== null &&
    Object.entries(x).some(([p, v]) => p !== "key" && usesKey(v, k)));
