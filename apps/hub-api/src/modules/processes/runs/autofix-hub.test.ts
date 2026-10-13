// HUB-FR-128 · HUB-FR-115 · PC-R05/R07/R10 · P-c1 B5 · unit: payload `autofix` + công cụ, khối prompt, view, `use_current` 409.
import { describe, expect, it } from "bun:test";
import type { JobAutofix } from "@ai/contracts/hub";
import type { AgentConfig, ProfileConfig } from "../../config/config.rules";
import { buildJobPayload, type PayloadInput } from "../../runner/runner.rules";
import { type RunState, transition } from "../core/process-state.rules";
import { autofixRetryBlock, autofixWorkspaceBlock } from "./autofix.rules";
import { toAutofixView } from "./view-autofix";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SHA = "a".repeat(40);
const agent: AgentConfig = {
  id: U(1),
  key: "fixer",
  name: { vi: "a", en: "a" },
  description: "",
  runtime: "agentic-cli",
  agentTypeKey: null,
  profileId: U(9),
  systemPrompt: "SP",
  runtimeOptions: { allowed_tools: ["Read", "Grep", "Write"] },
  timeoutS: 600,
  tokenBudget: null,
  enabled: true,
  version: 1,
} as AgentConfig;
const profile: ProfileConfig = {
  id: U(9),
  key: "p",
  steps: [{ provider_key: "fake-cli", model: null, on: [] }],
};
const af: JobAutofix = {
  source: {
    key: "app-repo",
    kind: "git_remote",
    pin: { kind: "git_remote", url: "https://github.com/x/y.git", sha: SHA },
    allowlist: [],
  },
  install_cmd: null,
  test_cmd: "bun test",
  write_allowlist: [],
  branch: `ai/${U(4)}/fix`,
  round: 1,
  base_patch: null,
};
const input = (o: Partial<PayloadInput> = {}): PayloadInput => ({
  jobId: U(2),
  stepId: U(3),
  run: { id: U(4), tenantId: U(5), userId: U(6), conversationId: U(7), flowId: U(8) },
  agent,
  role: "agent",
  profile,
  prompt: "Việc",
  systemPrompt: "SP",
  history: [],
  ...o,
});

describe("HUB-FR-128 · PC-R05/R07 · buildJobPayload autofix", () => {
  it("stage tự-sửa không nguồn chỉ-đọc ⇒ allowed_tools [] (bỏ Write của agent) + khoá autofix", () => {
    const p = buildJobPayload(input({ autofix: af }));
    expect([p?.allowed_tools, p?.autofix]).toEqual([[], af]);
  });
  it("có nguồn chỉ-đọc ⇒ Read/Grep/Glob; job thường không có khoá autofix", () => {
    const src = { ...af.source, key: "docs", allowlist: ["**"] };
    expect(buildJobPayload(input({ autofix: af, sources: [src] }))?.allowed_tools).toEqual([
      "Read",
      "Grep",
      "Glob",
    ]);
    expect(buildJobPayload(input())).not.toHaveProperty("autofix");
  });
});

describe("HUB-FR-115 · PC-R10 · khối prompt", () => {
  it("workspace nguyên văn plan §6.1, retry không mang detail bí mật", () => {
    const w = autofixWorkspaceBlock({ source_key: "app-repo", test_cmd: "bun test" });
    expect(w.startsWith("## Workspace\nBản sao repo `app-repo` (ghi được) ở /workspace")).toBe(
      true,
    );
    expect(w).toContain("Lệnh test: `bun test`.");
    const r = autofixRetryBlock([
      { check: "secrets", path: "a.ts", line: 3, rule: "aws_key", detail: "AKIAXXXX" },
    ]);
    expect(r).toBe("## Lần kiểm trước không đạt\nsecrets a.ts:3 aws_key");
  });
});

describe("HUB-FR-115 · PC-R10 · use_current cho autofix_* ⇒ PROCESS_RUN_STATE", () => {
  const st = (reason: RunState["decisionReason"], hasOutput: boolean): RunState => ({
    status: "needs_decision",
    stageIdx: 0,
    stageCount: 1,
    stage: {
      status: "needs_decision",
      attempt: 1,
      attemptLimit: 3,
      asksCount: 0,
      askLimit: 3,
      after: "review",
      hasOutput,
    },
    decisionReason: reason,
  });
  it("autofix_check_failed / sandbox_unavailable (kể cả có output) ⇒ 409; add_attempt ⇒ vòng mới", () => {
    for (const r of ["autofix_check_failed", "sandbox_unavailable"] as const) {
      expect(transition(st(r, true), { kind: "decide", option: "use_current" })).toEqual({
        ok: false,
        code: "PROCESS_RUN_STATE",
      });
      const t = transition(st(r, false), { kind: "decide", option: "add_attempt" });
      expect(t.ok && t.next.stage.attempt).toBe(2);
    }
  });
});

describe("HUB-FR-128 · PC-R09 · toAutofixView", () => {
  const row = {
    stage_idx: 0,
    source_key: "local-app",
    pin: { kind: "local_path", path: "/qc-roots/x" } as never,
    branch: `ai/${U(4)}/fix`,
    round: 2,
    status: "check_failed" as const,
    diff_stats: null,
    failures: [{ check: "tests" as const, detail: "exit 1" }],
    test_exit_code: 1,
    test_duration_ms: 20,
    created_at: "2026-10-14T00:00:00.000000Z",
    d_id: null,
    d_name: null,
    d_mime: null,
    d_size: null,
    l_id: U(7),
    l_name: "fix-r2-test.log.txt",
    l_mime: "text/plain",
    l_size: "6",
  };
  it("local_path ⇒ pin_sha null (không lộ path); log file map filename→name; test có", () => {
    const v = toAutofixView(row);
    expect(v.pin_sha).toBeNull();
    expect(JSON.stringify(v)).not.toContain("/qc-roots");
    expect(v.test_log_file).toEqual({
      id: U(7),
      name: "fix-r2-test.log.txt",
      mime: "text/plain",
      size: 6,
    });
    expect([v.diff_file, v.test]).toEqual([null, { exit_code: 1, duration_ms: 20 }]);
  });
  it("git_remote ⇒ pin_sha = sha; chưa chạy test ⇒ test null", () => {
    const v = toAutofixView({
      ...row,
      pin: { kind: "git_remote", sha: SHA },
      test_exit_code: null,
      test_duration_ms: null,
    });
    expect([v.pin_sha, v.test]).toEqual([SHA, null]);
  });
});
