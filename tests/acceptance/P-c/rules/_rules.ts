// HUB-FR-119 · HUB-FR-126…130 · P-c1 (plan §3, §4): nạp ĐỘNG contract + luật thuần Hub — test viết TRƯỚC code: import tĩnh
// symbol chưa có làm vỡ `bun run typecheck`. Module/export vắng ⇒ ca đỏ ở `fn()`/`schema()` ("qc: <tên> chưa có"). Không DB/env.
import { type Loose, loadProcRules } from "../../P-a/_support/modules";

export type { Loose };

/** plan §4 Hub: `processes/runs/autofix.rules.ts`. */
export const loadAutofix = (): Promise<Loose> => loadProcRules("runs/autofix.rules.ts");
export const loadHubAdmin = (): Promise<Loose> => import("@ai/contracts/hub-admin");
export const loadHub = (): Promise<Loose> => import("@ai/contracts/hub");
export const loadInternal = (): Promise<Loose> => import("@ai/contracts/hub-internal");
export const loadChat = (): Promise<Loose> => import("@ai/contracts/chat");

// biome-ignore lint/suspicious/noExplicitAny: module nạp động, kết quả kiểm bằng expect
export type Fn = (...a: any[]) => any;
/** Hàm theo tên; vắng ⇒ ném (ca đỏ đúng lý do). */
export function fn(m: Loose, name: string): Fn {
  const f = m[name];
  if (typeof f !== "function") throw new Error(`qc: ${name} chưa có (plan §4)`);
  return f as Fn;
}
/** Schema zod theo tên; vắng ⇒ ném. */
// biome-ignore lint/suspicious/noExplicitAny: schema zod nạp động
export function schema(m: Loose, name: string): any {
  const s = m[name];
  if (typeof s?.safeParse !== "function") throw new Error(`qc: ${name} chưa có (plan §3)`);
  return s;
}
export const ok = (s: { safeParse: Fn }, v: unknown): boolean => s.safeParse(v).success === true;
/** Đường dẫn issue zod (nối bằng `.`) — để so path của luật. */
export const issuePaths = (s: { safeParse: Fn }, v: unknown): string[] => {
  const r = s.safeParse(v);
  return r.success
    ? []
    : (r.error.issues as { path: (string | number)[] }[]).map((i) => i.path.join("."));
};

// ---------- dữ liệu mẫu (cố định) ----------
export const RUN = "c0c00000-0000-4000-8000-000000000001";
export const AGENT = "c0c00000-0000-4000-8000-000000000011";
export const TEAM = "c0c00000-0000-4000-8000-000000000012";
export const GROUP = "c0c00000-0000-4000-8000-000000000013";
export const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";
export const SHA2 = "b2c3d4e5f60718293a4b5c6d7e8f901234567890";
export const URL_APP = "https://github.com/pc-test/app-repo.git";
export const PIN_GIT = { kind: "git_remote", url: URL_APP, sha: SHA } as const;
export const ATT = {
  id: "c0c00000-0000-4000-8000-000000000021",
  name: "fix-r1.diff.txt",
  mime: "text/plain",
  size: 120,
  sha256: "a".repeat(64),
} as const;

export const AUTOFIX = {
  source_key: "app-repo",
  install_cmd: null,
  test_cmd: "bun test",
  write_allowlist: [],
};

/** Stage def đủ trường (contract `ProcessStageDefSchema`) — `o` ghi đè. */
// biome-ignore lint/suspicious/noExplicitAny: json theo contract
export function stage(o: Record<string, any> = {}): Record<string, any> {
  return {
    key: "fix",
    name: "Sửa lỗi",
    executor: { kind: "agent", agent_id: AGENT },
    instruction: "Sửa lỗi theo mô tả.",
    output: {
      filename: "fix.md",
      template: "## Kết quả\n",
      required_sections: ["Kết quả"],
      fields: [],
    },
    after: { kind: "review", group_id: GROUP },
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: 1800,
    token_budget: null,
    sources: [],
    must_know: [],
    ...o,
  };
}
export function defInput(
  stages: Record<string, unknown>[],
  sources = ["app-repo"],
): Record<string, unknown> {
  return {
    key: "fixbug-apply-t",
    name: "Tự sửa thử",
    description: "Quy trình thử P-c.",
    input_hint: "Mô tả lỗi",
    run_group_ids: [],
    stages,
    token_budget: null,
    enabled: true,
    sources,
    inputs: [],
  };
}

export const BRANCH = `ai/${RUN}/fix`;
/** Báo cáo hợp lệ `status=ok` (plan §3.3). */
export function report(o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: "ok",
    branch: BRANCH,
    base_sha: SHA,
    head_sha: SHA2,
    diff: "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n",
    diff_stats: { files: 1, insertions: 1, deletions: 1, bytes: 80 },
    test: { exit_code: 0, duration_ms: 12_400, log_tail: "1 pass" },
    failures: [],
    commands: [{ tool: "exec", arg: "bun test", exit_code: 0, ms: 900 }],
    ...o,
  };
}
