// HUB-FR-129 · HUB-FR-128 · HUB-FR-130 · HUB-BR-34 · P-c2 · plan §3–§4: nạp ĐỘNG contract + luật thuần Hub (mẫu P-c `_rules.ts`) —
// export/module vắng ⇒ ca đỏ ở `fn()`/`schema()`/expect, không vỡ `bun run typecheck`. Không DB/env. Dải id `c2c2…`.
import { loadProcRules } from "../../P-a/_support/modules";
import { type Loose, SHA, SHA2 } from "../../P-c/rules/_rules";

export {
  fn,
  issuePaths,
  type Loose,
  loadChat,
  loadHub,
  loadHubAdmin,
  loadInternal,
  ok,
  SHA,
  SHA2,
  schema,
  stage,
} from "../../P-c/rules/_rules";

/** plan §4 Hub: `processes/runs/apply.rules.ts`. */
export const loadApply = (): Promise<Loose> => loadProcRules("runs/apply.rules.ts");
/** P-c1 `autofix.rules.ts` (`autofixDecisionOptions` mở rộng — plan §4). */
export const loadAutofix = (): Promise<Loose> => loadProcRules("runs/autofix.rules.ts");
export const loadCoreTask = (): Promise<Loose> => loadProcRules("core/task.rules.ts");

export const X = (n: number) => `c2c20000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const RUN = X(1);
export const SRC_ID = X(2);
export const CRED = X(3);
export const BRANCH = `ai/${RUN}/fix`;
export const GH_URL = "https://github.com/pc2-test/app-repo.git";
export const GL_URL = "https://gitlab.com/pc2-test/app-repo.git";
export const PATCH = {
  id: X(21),
  name: "fix-r1.diff.txt",
  mime: "text/plain",
  size: 120,
  sha256: "a".repeat(64),
} as const;
export const SECRET = "AKIAQCQCQCQCQCQCQCQC";
export const TOKEN = "ghp-qc-PC2-Zx9Pq7Lm";

/** `SourceApplyJob` hợp lệ (plan §3.3); `o` ghi đè. */
export function applyJob(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    type: "source.apply",
    job_id: X(31),
    tenant_id: X(32),
    process_run_id: RUN,
    source: {
      source_id: SRC_ID,
      key: "app-repo",
      url: GH_URL,
      branch: "main",
      has_credential: true,
    },
    pin_sha: SHA,
    branch: BRANCH,
    apply_mode: "pr",
    push_only: false,
    patch: PATCH,
    install_cmd: null,
    test_cmd: "bun test",
    write_allowlist: [],
    timeout_s: 600,
    ...o,
  };
}

/** `ApplyReport` hợp lệ `pushed` (plan §3.5); `o` ghi đè. */
export function applyReport(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "pushed",
    target_sha: SHA,
    head_sha: SHA2,
    rebased: false,
    code: null,
    conflict_files: [],
    failures: [],
    test: null,
    ...o,
  };
}

/** `ApplyStageView` hợp lệ `pr_opened` (plan §3.6); `o` ghi đè. */
export function applyView(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "pr",
    status: "pr_opened",
    branch: BRANCH,
    target_sha: SHA,
    head_sha: SHA2,
    rebased: false,
    provider: "github",
    pr_number: 42,
    pr_url: "https://github.com/pc2-test/app-repo/pull/42",
    auto_merge: null,
    error_code: null,
    conflict_files: [],
    failures: [],
    test_log_file: null,
    created_at: "2026-10-14T08:00:00.000Z",
    ...o,
  };
}
