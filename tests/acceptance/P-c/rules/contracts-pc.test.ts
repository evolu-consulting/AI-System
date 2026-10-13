// HUB-FR-119 · HUB-FR-126 · HUB-FR-128 · HUB-FR-130 · WRK-FR-29 · HUB-BR-33 · P-c1 · spec §3, plan §3.1–§3.4 · test-plan §3 C01–C16.
// Contract zod (nạp động — export vắng ⇒ đỏ ở `schema()`/expect). Không DB/env.
import { describe, expect, it } from "bun:test";
import {
  ATT,
  AUTOFIX,
  BRANCH,
  defInput,
  issuePaths,
  loadChat,
  loadHub,
  loadHubAdmin,
  loadInternal,
  ok,
  PIN_GIT,
  RUN,
  report,
  SHA,
  schema,
  stage,
} from "./_rules";

const ha = await loadHubAdmin();
const hub = await loadHub();
const internal = await loadInternal();
const chat = await loadChat();

const jobAutofix = (o: Record<string, unknown> = {}) => ({
  source: { key: "app-repo", kind: "git_remote", pin: PIN_GIT, allowlist: [] },
  install_cmd: null,
  test_cmd: "bun test",
  write_allowlist: [],
  branch: BRANCH,
  round: 1,
  base_patch: null,
  ...o,
});

describe("C01–C05 · StageAutofix + ProcessStageDef.autofix [plan §3.1]", () => {
  it("HUB-FR-126 · C01 · StageAutofixSchema: tối thiểu {source_key, test_cmd} ⇒ install_cmd null, write_allowlist []", () => {
    const s = schema(ha, "StageAutofixSchema");
    const r = s.safeParse({ source_key: "app-repo", test_cmd: "bun test" });
    expect(r.success).toBe(true);
    expect({ install: r.data?.install_cmd, allow: r.data?.write_allowlist }).toEqual({
      install: null,
      allow: [],
    });
  });
  it("HUB-FR-126 · C02 · test_cmd bắt buộc, trim 1..1000; install_cmd 1..1000|null, không NUL; allowlist ≤ 20 glob; strict", () => {
    const s = schema(ha, "StageAutofixSchema");
    expect(ok(s, { ...AUTOFIX, test_cmd: "x".repeat(1000) })).toBe(true);
    expect(ok(s, { ...AUTOFIX, install_cmd: "bun install" })).toBe(true);
    const bad = [
      { source_key: "app-repo" },
      { ...AUTOFIX, test_cmd: "   " },
      { ...AUTOFIX, test_cmd: "x".repeat(1001) },
      { ...AUTOFIX, install_cmd: "x".repeat(1001) },
      { ...AUTOFIX, install_cmd: "bun\0install" },
      { ...AUTOFIX, install_cmd: "" },
      { ...AUTOFIX, write_allowlist: Array.from({ length: 21 }, (_, i) => `src/d${i}/**`) },
      { ...AUTOFIX, write_allowlist: ["../x/**"] },
      { ...AUTOFIX, write_allowlist: ["/etc/**"] },
      { ...AUTOFIX, push: true },
    ];
    expect(bad.map((v) => ok(s, v))).toEqual(bad.map(() => false));
  });
  it("HUB-FR-126 · C03 · ProcessStageDefSchema: vắng autofix ⇒ null (def cũ); có autofix hợp lệ ⇒ giữ nguyên", () => {
    const s = schema(ha, "ProcessStageDefSchema");
    expect(s.safeParse(stage()).data?.autofix).toBeNull();
    const r = s.safeParse(stage({ autofix: AUTOFIX }));
    expect(r.success).toBe(true);
    expect(r.data?.autofix?.test_cmd).toBe("bun test");
  });
  it("HUB-FR-126 · PC-R01 · C04 · ProcessDefInputSchema: autofix.source_key ∉ def.sources ⇒ issue `stages.0.autofix.source_key`", () => {
    const s = schema(ha, "ProcessDefInputSchema");
    expect(ok(s, defInput([stage({ autofix: AUTOFIX })]))).toBe(true);
    const bad = defInput([stage({ autofix: { ...AUTOFIX, source_key: "other-repo" } })]);
    expect(issuePaths(s, bad)).toContain("stages.0.autofix.source_key");
  });
  it("HUB-BR-34 · PC-R02 · C05 · PROCESS_DEF_RULES thêm CUỐI: AUTOFIX_EXECUTOR, AUTOFIX_REVIEW, AUTOFIX_MAX (giữ thứ tự cũ)", () => {
    expect(ha.PROCESS_DEF_RULES).toEqual([
      "KEY_DUP",
      "REAL_ACTION",
      "STEP_INCOMPLETE",
      "STEP_ORDER",
      "STEP_TOO_WIDE",
      "BACK_TARGET_INVALID",
      "AUTOFIX_EXECUTOR",
      "AUTOFIX_REVIEW",
      "AUTOFIX_MAX",
    ]);
  });
});

describe("C06–C09 · job [plan §3.2]", () => {
  it("HUB-FR-128 · PC-R05 · C06 · JobAutofixSchema: hợp lệ; source.allowlist phải []; round 1..100; base_patch null|JobAttachment", () => {
    const s = schema(hub, "JobAutofixSchema");
    expect(ok(s, jobAutofix())).toBe(true);
    expect(ok(s, jobAutofix({ round: 3, base_patch: ATT }))).toBe(true);
    const bad = [
      jobAutofix({
        source: { key: "app-repo", kind: "git_remote", pin: PIN_GIT, allowlist: ["src/**"] },
      }),
      jobAutofix({ round: 0 }),
      jobAutofix({ round: 101 }),
      jobAutofix({ test_cmd: "" }),
    ];
    expect(bad.map((v) => ok(s, v))).toEqual([false, false, false, false]);
  });
  it("HUB-FR-128 · E1 · C07 · nhánh = `ai/<uuid run>/<stage_key>` với stage_key khớp STAGE_KEY_RE; mọi biến thể khác bị chặn", () => {
    const s = schema(hub, "JobAutofixSchema");
    const good = [`ai/${RUN}/fix`, `ai/${RUN}/a`, `ai/${RUN}/${"a".repeat(32)}`, `ai/${RUN}/fix-2`];
    expect(good.map((b) => ok(s, jobAutofix({ branch: b })))).toEqual(good.map(() => true));
    const bad = [
      "main",
      `feature/${RUN}/fix`,
      `ai/${RUN}/Fix`,
      `ai/${RUN}/fix 2`,
      `ai/${RUN}/../main`,
      `ai/${RUN}/fix/x`,
      `ai/${RUN}/${"a".repeat(33)}`,
      "ai/not-a-uuid/fix",
      `ai/${RUN}/`,
      `ai/${RUN}/fix;rm`,
    ];
    expect(bad.map((b) => ok(s, jobAutofix({ branch: b })))).toEqual(bad.map(() => false));
  });
  it("HUB-FR-128 · C08 · AgentCliJobSchema.shape.autofix tồn tại và optional (job cũ vắng autofix vẫn hợp lệ)", () => {
    const s = schema(hub, "AgentCliJobSchema");
    const f = s.shape?.autofix;
    expect(f).toBeDefined();
    expect(f?.safeParse(undefined).success).toBe(true);
    expect(f?.safeParse(jobAutofix()).success).toBe(true);
  });
  it("HUB-FR-126 · PC-R04 · C09 · ResolveItem.caps optional `source|autofix`; JOB_FAIL_REASONS += container (giữ mã cũ)", () => {
    const s = schema(hub, "ResolveItemSchema");
    const base = {
      source_id: "c0c00000-0000-4000-8000-000000000031",
      key: "app-repo",
      kind: "git_remote",
      config: { kind: "git_remote", url: PIN_GIT.url, branch: "main" },
      allowlist_union: [],
    };
    expect([
      ok(s, base),
      ok(s, { ...base, caps: "autofix" }),
      ok(s, { ...base, caps: "source" }),
    ]).toEqual([true, true, true]);
    expect(ok(s, { ...base, caps: "write" })).toBe(false);
    expect(hub.JOB_FAIL_REASONS).toContain("container");
    for (const old of ["sandbox", "upstream", "timeout", "orphaned"])
      expect(hub.JOB_FAIL_REASONS).toContain(old);
  });
});

describe("C10–C13 · AutofixReport [plan §3.3]", () => {
  it("WRK-FR-29 · C10 · báo cáo `ok` hợp lệ; `no_changes`/`check_failed` không diff, diff_stats null", () => {
    const s = schema(internal, "AutofixReportSchema");
    expect(ok(s, report())).toBe(true);
    const nc = report({ status: "no_changes", diff: null, diff_stats: null, test: null });
    const cf = report({
      status: "check_failed",
      diff: null,
      diff_stats: null,
      failures: [
        { check: "secrets", path: "src/a.ts", line: 3, rule: "aws_key", detail: "khớp mẫu" },
      ],
    });
    expect([ok(s, nc), ok(s, cf)]).toEqual([true, true]);
  });
  it("WRK-FR-29 · PC-R08 · C11 · bất biến `diff ≠ null ⇔ status=ok`, `diff_stats ≠ null ⇔ ok`", () => {
    const s = schema(internal, "AutofixReportSchema");
    const bad = [
      report({ diff: null }),
      report({ diff_stats: null }),
      report({ status: "check_failed" }),
      report({ status: "no_changes" }),
      report({ status: "no_changes", diff: null }),
      report({ status: "merged" }),
    ];
    expect(bad.map((v) => ok(s, v))).toEqual(bad.map(() => false));
  });
  it("WRK-FR-29 · C12 · trần: diff ≤ 2 MiB, failures ≤ 50 (check enum, detail ≤ 500), commands ≤ 300 (tool enum, arg ≤ 500), log_tail ≤ 64 KiB, sha 40 hex", () => {
    const s = schema(internal, "AutofixReportSchema");
    const f = (o: Record<string, unknown> = {}) => ({
      check: "paths",
      path: "a",
      detail: "x",
      ...o,
    });
    const c = (o: Record<string, unknown> = {}) => ({ tool: "exec", arg: "ls", ms: 1, ...o });
    expect(ok(s, report({ diff: "d".repeat(2_097_152) }))).toBe(true);
    const bad = [
      report({ diff: "d".repeat(2_097_153) }),
      report({
        status: "check_failed",
        diff: null,
        diff_stats: null,
        failures: Array.from({ length: 51 }, () => f()),
      }),
      report({
        status: "check_failed",
        diff: null,
        diff_stats: null,
        failures: [f({ check: "lint" })],
      }),
      report({
        status: "check_failed",
        diff: null,
        diff_stats: null,
        failures: [f({ detail: "x".repeat(501) })],
      }),
      report({ commands: Array.from({ length: 301 }, () => c()) }),
      report({ commands: [c({ tool: "bash" })] }),
      report({ commands: [c({ arg: "x".repeat(501) })] }),
      report({ test: { exit_code: 0, duration_ms: 1, log_tail: "x".repeat(65_537) } }),
      report({ base_sha: "HEAD" }),
      report({ head_sha: SHA.toUpperCase() }),
      report({ diff_stats: { files: 301, insertions: 1, deletions: 0, bytes: 1 } }),
    ];
    expect(bad.map((v) => ok(s, v))).toEqual(bad.map(() => false));
    for (const k of ["paths", "size", "secrets", "tests", "install", "apply_patch"])
      expect(
        ok(
          s,
          report({
            status: "check_failed",
            diff: null,
            diff_stats: null,
            failures: [f({ check: k })],
          }),
        ),
      ).toBe(true);
  });
  it("HUB-FR-130 · C13 · HUB_INTERNAL_ERRORS: AUTOFIX_NOT_EXPECTED 409, AUTOFIX_RESULT_EXISTS 409", () => {
    expect({
      ne: internal.HUB_INTERNAL_ERRORS?.AUTOFIX_NOT_EXPECTED,
      ex: internal.HUB_INTERNAL_ERRORS?.AUTOFIX_RESULT_EXISTS,
    }).toEqual({ ne: 409, ex: 409 });
  });
});

describe("C14–C16 · chat view + quyết định [plan §3.4]", () => {
  const view = (o: Record<string, unknown> = {}) => ({
    source_key: "app-repo",
    pin_sha: SHA,
    branch: BRANCH,
    round: 1,
    status: "ok",
    diff_stats: { files: 1, insertions: 1, deletions: 1, bytes: 80 },
    diff_file: null,
    test_log_file: null,
    test: { exit_code: 0, duration_ms: 12_400 },
    failures: [],
    created_at: "2026-10-13T08:00:00.000Z",
    ...o,
  });
  it("HUB-FR-115 · PC-R10 · C14 · DECISION_REASONS thêm CUỐI autofix_check_failed, sandbox_unavailable (16 mã cũ giữ thứ tự)", () => {
    const r = chat.DECISION_REASONS as string[];
    expect(r.slice(0, 16)).toEqual([
      "redo_limit",
      "ask_limit",
      "template_invalid",
      "team_calls",
      "team_tokens",
      "team_time",
      "team_no_change",
      "job_timeout",
      "stage_tokens",
      "run_tokens",
      "agent_failed",
      "permission_lost",
      "user_inactive",
      "interrupted",
      "source_unresolvable",
      "back_limit",
    ]);
    expect(r.slice(16)).toEqual(["autofix_check_failed", "sandbox_unavailable"]);
  });
  it("HUB-FR-128 · C15 · AutofixStageViewSchema: pin_sha null (local_path) hợp lệ; status ngoài enum / thiếu branch ⇒ lỗi", () => {
    const s = schema(chat, "AutofixStageViewSchema");
    expect([
      ok(s, view()),
      ok(s, view({ pin_sha: null, status: "check_failed", diff_stats: null, test: null })),
    ]).toEqual([true, true]);
    const { branch: _b, ...noBranch } = view();
    expect([
      ok(s, view({ status: "merged" })),
      ok(s, noBranch),
      ok(s, view({ path: "/srv/repo" })),
    ]).toEqual([false, false, false]);
  });
  it("HUB-FR-128 · C16 · StageViewSchema.shape.autofix optional (stage thường vắng) và nhận AutofixStageView", () => {
    const s = schema(chat, "StageViewSchema");
    const f = s.shape?.autofix;
    expect(f).toBeDefined();
    expect([f?.safeParse(undefined).success, f?.safeParse(view()).success]).toEqual([true, true]);
  });
});
