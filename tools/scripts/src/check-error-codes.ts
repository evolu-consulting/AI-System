// CR-125 G1 · `bun run check:error-codes` (trong `bun run check` + cổng sau rebase của slice:merge): mã lỗi một nguồn (audit #12, check 7).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PARALLEL_CODES,
  PARALLEL_KEY,
} from "../../../packages/contracts/src/hub-admin/process-approve";
import { HUB_ADMIN_LIBRARY_ERRORS } from "../../../packages/contracts/src/hub-admin/process-library";
import {
  PROCESS_START_ERROR_KEY,
  PROCESS_START_ERRORS,
} from "../../../packages/contracts/src/hub-admin/process-start";
import { HUB_ADMIN_SUBPROCESS_ERRORS } from "../../../packages/contracts/src/hub-admin/process-subprocess";
import {
  START_FORM_CONFIG_CODES,
  START_FORM_CONFIG_KEY,
} from "../../../packages/contracts/src/modules/core/start-form/config";
import {
  READINESS_CODES,
  READINESS_KEY,
} from "../../../packages/contracts/src/modules/template-readiness";
import {
  PUBLISH_ISSUE_CODES,
  PUBLISH_ISSUE_KEY,
} from "../../../packages/contracts/src/pack-contracts/publish-issue-codes";
import { type CodeSet, hubTextIssues, keyIssues } from "./check-error-codes.rules";
import { git, repoRoot } from "./lib/git";
import { readLocaleEntries } from "./lib/locale-files";

/** Mã lỗi khai ở `packages/contracts` + khoá chuẩn của câu. Thêm bộ mã mới ⇒ thêm một dòng ở đây. */
export const CODE_SETS: readonly CodeSet[] = [
  { name: "publish-issue", codes: PUBLISH_ISSUE_CODES, prefix: PUBLISH_ISSUE_KEY },
  { name: "template-readiness", codes: READINESS_CODES, prefix: READINESS_KEY },
  { name: "parallel-approval", codes: PARALLEL_CODES, prefix: PARALLEL_KEY },
  { name: "start-form-config", codes: START_FORM_CONFIG_CODES, prefix: START_FORM_CONFIG_KEY },
  {
    name: "process-start",
    codes: Object.keys(PROCESS_START_ERRORS),
    prefix: PROCESS_START_ERROR_KEY,
  },
  {
    name: "hub-admin-subprocess",
    codes: Object.keys(HUB_ADMIN_SUBPROCESS_ERRORS),
    prefix: "process.admin.apiError",
  },
  {
    name: "hub-admin-library",
    codes: Object.keys(HUB_ADMIN_LIBRARY_ERRORS),
    prefix: "process.admin.apiError",
  },
];

function main(): number {
  const root = repoRoot();
  const ls = git(["-c", "core.quotePath=false", "ls-files", "--", "apps/hub-api/src"], root);
  if (!ls.ok) throw new Error("check:error-codes: không đọc được git index");
  const files = new Map<string, string>();
  for (const f of ls.out.split("\n").map((l) => l.trim())) {
    if (!/\.ts$/.test(f)) continue;
    try {
      files.set(f, readFileSync(join(root, f), "utf8"));
    } catch {
      // file đã xoá khỏi cây làm việc nhưng còn trong index
    }
  }
  const codes = CODE_SETS.flatMap((s) => s.codes);
  const bad = [...keyIssues(CODE_SETS, readLocaleEntries(root)), ...hubTextIssues(files, codes)];
  if (bad.length === 0) {
    console.log("check:error-codes OK");
    return 0;
  }
  console.error(
    `check:error-codes: ${bad.length} vi phạm — mỗi mã một khoá i18n; hub chỉ trả mã + biến:`,
  );
  for (const i of bad) console.error(`  ${i.file}${i.line ? `:${i.line}` : ""}  ${i.msg}`);
  return 1;
}

if (import.meta.main) process.exit(main());
