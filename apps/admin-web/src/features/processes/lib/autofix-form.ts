// HUB-FR-119 · HUB-FR-126 · ADM-FR-65 · P-c1 F2: form "Tự sửa mã" của một stage (bản nháp ↔ `StageAutofix`) + validate khớp contract.
// Hàm thuần: không React, không gọi API. Luật chéo (executor/after/tối đa 1) dùng chung server: `autofixStageIssues`.
import {
  AUTOFIX_CMD_MAX,
  type AutofixStageShape,
  autofixStageIssues,
  GlobSchema,
  STAGE_ALLOWLIST_MAX,
  type StageAutofix,
} from "@ai/contracts/hub-admin";

export type AutofixDraft = {
  on: boolean;
  source: string;
  install: string;
  test: string;
  allow: string;
};
/** Phần của `StageDraft` mà module này đọc (cấu trúc, tránh vòng phụ thuộc với `def-form`). */
export type AutofixPart = {
  name: string;
  executor: string;
  after: "review" | "auto";
  autofix: AutofixDraft;
};
type Errors = Record<string, string>;

const A = "process.admin.autofix.";
/** `AUTOFIX_*` (mã luật server) → khoá câu lỗi; path do contract trả. */
export const AUTOFIX_RULE_ERR: Record<string, string> = {
  AUTOFIX_EXECUTOR: `${A}err.AUTOFIX_EXECUTOR`,
  AUTOFIX_REVIEW: `${A}err.AUTOFIX_REVIEW`,
  AUTOFIX_MAX: `${A}err.AUTOFIX_MAX`,
};

export const emptyAutofix = (): AutofixDraft => ({
  on: false,
  source: "",
  install: "",
  test: "",
  allow: "",
});

const lines = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

export const autofixToDraft = (a: StageAutofix | null | undefined): AutofixDraft =>
  a
    ? {
        on: true,
        source: a.source_key,
        install: a.install_cmd ?? "",
        test: a.test_cmd,
        allow: a.write_allowlist.join("\n"),
      }
    : emptyAutofix();

/** Tắt ⇒ `null` (giá trị đã nhập vẫn giữ trong bản nháp — FC8). */
export const autofixToDef = (a: AutofixDraft): StageAutofix | null =>
  a.on
    ? {
        source_key: a.source,
        install_cmd: a.install.trim() === "" ? null : a.install.trim(),
        test_cmd: a.test.trim(),
        write_allowlist: lines(a.allow),
      }
    : null;

const cmdBad = (s: string): boolean => s.length > AUTOFIX_CMD_MAX || s.includes("\0");

/** Lỗi ô của MỘT stage (path như contract): nguồn, lệnh test/cài, allowlist. */
export function autofixFieldErrors(a: AutofixDraft, i: number): Errors {
  const e: Errors = {};
  if (!a.on) return e;
  const at = (f: string) => `stages.${i}.autofix.${f}`;
  if (a.source === "") e[at("source_key")] = `${A}err.source`;
  const test = a.test.trim();
  if (test === "" || cmdBad(test)) e[at("test_cmd")] = `${A}err.test`;
  const install = a.install.trim();
  if (install !== "" && cmdBad(install)) e[at("install_cmd")] = `${A}err.install`;
  const globs = lines(a.allow);
  if (globs.length > STAGE_ALLOWLIST_MAX || globs.some((g) => !GlobSchema.safeParse(g).success))
    e[at("write_allowlist")] = `${A}err.allow`;
  return e;
}

/** Luật chéo giữa các stage (dùng chung với server) → lỗi theo path. */
export function autofixCrossErrors(stages: readonly AutofixPart[]): Errors {
  const shape: AutofixStageShape[] = stages.map((s) => ({
    key: s.name,
    step: 0,
    real_action: false,
    executor: { kind: s.executor.startsWith("team:") ? "team" : "agent" },
    after: { kind: s.after, back_to_steps: [] },
    autofix: s.autofix.on ? { source_key: s.autofix.source } : null,
  }));
  const e: Errors = {};
  for (const issue of autofixStageIssues(shape)) {
    const key = AUTOFIX_RULE_ERR[issue.rule];
    if (key) e[issue.path] = key;
  }
  return e;
}

/** Gộp lỗi tự-sửa của mọi stage vào `e` (dùng ở `validateDraft`). */
export function validateAutofixPart(stages: readonly AutofixPart[], e: Errors): void {
  for (const [i, s] of stages.entries()) Object.assign(e, autofixFieldErrors(s.autofix, i));
  Object.assign(e, autofixCrossErrors(stages));
}

/** Tên stage tự-sửa đầu tiên khác `i` (tham số `{{stage}}` của `AUTOFIX_MAX`). */
export const otherAutofixName = (stages: readonly AutofixPart[], i: number): string =>
  stages.find((s, j) => j !== i && s.autofix.on)?.name ?? "";

/** Khối hợp lệ để hiện huy hiệu "Hợp lệ": bật, đủ nguồn + test, không lỗi ô. */
export const autofixValid = (a: AutofixDraft, i: number): boolean =>
  a.on && Object.keys(autofixFieldErrors(a, i)).length === 0;
