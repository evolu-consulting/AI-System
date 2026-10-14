// HUB-FR-129 · HUB-FR-128 · HUB-FR-130 · HUB-FR-68 · HUB-BR-34 · HUB-BR-30 · P-c2 · spec §3, plan §3.1–§3.6, §4 (contracts) ·
// test-plan P-c2 §4 C01–C16. Contract zod + hàm thuần contracts (nạp động — vắng ⇒ đỏ ở `schema()`/`fn()`/expect). Không DB/env.
import { describe, expect, it } from "bun:test";
import {
  applyJob,
  applyReport,
  applyView,
  BRANCH,
  CRED,
  fn,
  GH_URL,
  GL_URL,
  loadChat,
  loadHub,
  loadHubAdmin,
  loadInternal,
  ok,
  RUN,
  SHA,
  schema,
  stage,
} from "./_rules2";

const ha = await loadHubAdmin();
const hub = await loadHub();
const internal = await loadInternal();
const chat = await loadChat();

const git = (o: Record<string, unknown> = {}) => ({
  kind: "git_remote",
  url: GH_URL,
  branch: "main",
  ...o,
});

describe("C01–C05 · nguồn: khoá + apply_mode [plan §3.1, PC2-R02, PC2-R10]", () => {
  it("HUB-FR-129 · HUB-FR-68 · C01 · GitRemoteConfigSchema: cấu hình cũ (không 2 trường) ⇒ credential_secret_id null, apply_mode vắng; uuid/3 chế độ nhận; sai ⇒ chặn", () => {
    const s = schema(ha, "GitRemoteConfigSchema");
    const old = s.safeParse(git());
    expect(old.success).toBe(true);
    expect({ cred: old.data?.credential_secret_id, mode: old.data?.apply_mode }).toEqual({
      cred: null,
      mode: undefined,
    });
    for (const m of ["pr", "auto_merge", "branch_only"])
      expect(ok(s, git({ credential_secret_id: CRED, apply_mode: m }))).toBe(true);
    const bad = [
      git({ credential_secret_id: "khoa-1" }),
      git({ apply_mode: "push" }),
      git({ apply_mode: "" }),
      git({ token: "ghp_x" }),
    ];
    expect(bad.map((v) => ok(s, v))).toEqual(bad.map(() => false));
  });
  it("HUB-FR-129 · C02 · APPLY_MODES = [pr, auto_merge, branch_only]; GIT_PROVIDERS = [github]; LocalPathConfig KHÔNG nhận apply_mode/khoá", () => {
    expect(ha.APPLY_MODES).toEqual(["pr", "auto_merge", "branch_only"]);
    expect(ha.GIT_PROVIDERS).toEqual(["github"]);
    const s = schema(ha, "LocalPathConfigSchema");
    expect(ok(s, { kind: "local_path", path: "/srv/app", apply_mode: "branch_only" })).toBe(false);
    expect(ok(s, { kind: "local_path", path: "/srv/app", credential_secret_id: CRED })).toBe(false);
  });
  it("HUB-FR-129 · PC2-R10 · PC2-R02 · C03 · SOURCE_ERRORS thêm CUỐI SOURCE_CREDENTIAL_INVALID 422, SOURCE_APPLY_UNSUPPORTED 422 (giữ thứ tự cũ)", () => {
    expect(Object.entries(ha.SOURCE_ERRORS)).toEqual([
      ["SOURCE_KEY_TAKEN", 409],
      ["SOURCE_HOST_NOT_ALLOWED", 422],
      ["SOURCE_UNRESOLVABLE", 422],
      ["SOURCE_IN_USE", 409],
      ["SOURCE_FORBIDDEN_KIND", 403],
      ["SOURCE_TOO_LARGE", 422],
      ["SOURCE_NOT_FOUND", 404],
      ["SOURCE_CREDENTIAL_INVALID", 422],
      ["SOURCE_APPLY_UNSUPPORTED", 422],
    ]);
  });
  it("HUB-FR-129 · Q1 · C04 · gitProviderOf: github.com (mọi hoa-thường) ⇒ github; gitlab/GHES/giả mạo/URL hỏng ⇒ null", () => {
    const f = fn(ha, "gitProviderOf");
    expect(f(GH_URL)).toBe("github");
    expect(f("https://GitHub.com/pc2-test/app-repo")).toBe("github");
    for (const u of [
      GL_URL,
      "https://github.example.com/acme/app.git",
      "https://github.com.evil.io/acme/app.git",
      "https://evilgithub.com/acme/app.git",
      "không phải url",
      "",
    ])
      expect({ u, p: f(u) }).toEqual({ u, p: null });
  });
  it("HUB-FR-129 · PC2-R02 · E5 · C05 · effectiveApplyMode + applyModeIssue: local ⇒ branch_only; git có mode ⇒ mode; vắng ⇒ pr (github) | branch_only (khác); pr/auto_merge trên host khác ⇒ SOURCE_APPLY_UNSUPPORTED", () => {
    const f = fn(ha, "effectiveApplyMode");
    expect(f({ kind: "local_path" })).toBe("branch_only");
    expect(f({ kind: "local_path", apply_mode: "pr" })).toBe("branch_only");
    expect(f({ kind: "library" })).toBe("branch_only");
    expect(f({ kind: "git_remote", url: GH_URL })).toBe("pr");
    expect(f({ kind: "git_remote", url: GL_URL })).toBe("branch_only");
    expect(f({ kind: "git_remote", url: GH_URL, apply_mode: "auto_merge" })).toBe("auto_merge");
    expect(f({ kind: "git_remote", url: GH_URL, apply_mode: "branch_only" })).toBe("branch_only");
    const g = fn(ha, "applyModeIssue");
    expect(g(git({ url: GL_URL, apply_mode: "pr" }))).toBe("SOURCE_APPLY_UNSUPPORTED");
    expect(g(git({ url: GL_URL, apply_mode: "auto_merge" }))).toBe("SOURCE_APPLY_UNSUPPORTED");
    expect(g(git({ url: GL_URL, apply_mode: "branch_only" }))).toBeNull();
    expect(g(git({ url: GL_URL }))).toBeNull();
    expect(g(git({ apply_mode: "auto_merge" }))).toBeNull();
    expect(g({ kind: "local_path", path: "/srv/app" })).toBeNull();
  });
});

describe("C06–C07 · stage def executor apply [plan §3.2, PC2-R01]", () => {
  it("HUB-BR-34 · C06 · ProcessStageDefSchema nhận executor {kind:'apply'} (strict: thêm khoá ⇒ chặn); EXECUTOR_KINDS thêm 'apply' CUỐI", () => {
    const s = schema(ha, "ProcessStageDefSchema");
    const ap = stage({
      key: "apply",
      executor: { kind: "apply" },
      real_action: true,
      after: { kind: "auto" },
    });
    expect(s.safeParse(ap).success).toBe(true);
    expect(ok(s, { ...ap, executor: { kind: "apply", agent_id: RUN } })).toBe(false);
    expect(chat.EXECUTOR_KINDS).toEqual(["agent", "team", "apply"]);
  });
  it("HUB-BR-34 · C07 · PROCESS_DEF_RULES thêm CUỐI APPLY_REAL, APPLY_AFTER, APPLY_NO_AUTOFIX, APPLY_MAX, APPLY_FIELDS", () => {
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
      "APPLY_REAL",
      "APPLY_AFTER",
      "APPLY_NO_AUTOFIX",
      "APPLY_MAX",
      "APPLY_FIELDS",
    ]);
  });
});

describe("C08–C09 · job source.apply [plan §3.3, PC2-R06, PC2-R11]", () => {
  it("HUB-FR-129 · WRK-FR-29 · C08 · SourceApplyJobSchema hợp lệ; JobPayloadSchema nhận; sai từng ràng buộc ⇒ chặn (push_only ≠ branch_only, nhánh ngoài ai/, sha, timeout, url có token)", () => {
    const s = schema(hub, "SourceApplyJobSchema");
    expect(s.safeParse(applyJob()).success).toBe(true);
    expect(ok(s, applyJob({ apply_mode: "branch_only", push_only: true }))).toBe(true);
    expect(schema(hub, "JobPayloadSchema").safeParse(applyJob()).success).toBe(true);
    const src = (applyJob().source ?? {}) as Record<string, unknown>;
    const bad = [
      applyJob({ apply_mode: "branch_only", push_only: false }),
      applyJob({ apply_mode: "pr", push_only: true }),
      applyJob({ branch: "main" }),
      applyJob({ branch: "ai/khong-phai-uuid/fix" }),
      applyJob({ branch: `ai/${RUN}/Fix` }),
      applyJob({ pin_sha: "HEAD" }),
      applyJob({ pin_sha: SHA.toUpperCase() }),
      applyJob({ timeout_s: 59 }),
      applyJob({ timeout_s: 3601 }),
      applyJob({ process_run_id: null }),
      applyJob({ token: "ghp_x" }),
      applyJob({ source: { ...src, url: "https://x-access-token:ghp_x@github.com/a/b.git" } }),
      applyJob({ source: { ...src, token: "ghp_x" } }),
    ];
    expect(bad.map((v) => ok(s, v))).toEqual(bad.map(() => false));
  });
  it("HUB-BR-30 · PC2-R11 · C09 · kênh khoá: request strict {source_id uuid}; 200 {username 1..64, token 1..4096}; HUB_INTERNAL_ERRORS thêm APPLY_NOT_EXPECTED/APPLY_RESULT_EXISTS 409 (cuối)", () => {
    const rq = schema(internal, "SourceCredentialRequestSchema");
    expect(ok(rq, { source_id: CRED })).toBe(true);
    expect([ok(rq, { source_id: "x" }), ok(rq, { source_id: CRED, job_id: CRED })]).toEqual([
      false,
      false,
    ]);
    const rs = schema(internal, "SourceCredentialResponseSchema");
    expect(ok(rs, { username: "x-access-token", token: "t" })).toBe(true);
    expect([
      ok(rs, { username: "", token: "t" }),
      ok(rs, { username: "u", token: "" }),
      ok(rs, { username: "u", token: "t".repeat(4097) }),
    ]).toEqual([false, false, false]);
    const keys = Object.keys(internal.HUB_INTERNAL_ERRORS);
    expect(keys.slice(-2)).toEqual(["APPLY_NOT_EXPECTED", "APPLY_RESULT_EXISTS"]);
    expect([
      internal.HUB_INTERNAL_ERRORS.APPLY_NOT_EXPECTED,
      internal.HUB_INTERNAL_ERRORS.APPLY_RESULT_EXISTS,
    ]).toEqual([409, 409]);
  });
});

describe("C10–C11 · báo cáo Áp [plan §3.5]", () => {
  it("HUB-FR-129 · E4 · C10 · ApplyReportSchema: pushed/conflict/check_failed/failed hợp lệ theo bất biến", () => {
    const s = schema(internal, "ApplyReportSchema");
    const good = [
      applyReport(),
      applyReport({ rebased: true }),
      applyReport({ status: "conflict", head_sha: null, conflict_files: ["src/a.ts"] }),
      applyReport({
        status: "check_failed",
        head_sha: null,
        rebased: true,
        failures: [{ check: "tests", detail: "exit 1" }],
        test: { exit_code: 1, duration_ms: 2000, log_tail: "1 fail" },
      }),
      applyReport({ status: "failed", head_sha: null, code: "push_rejected" }),
      applyReport({ status: "failed", target_sha: null, head_sha: null, code: "auth" }),
      applyReport({ detail: "x".repeat(300) }),
    ];
    expect(good.map((v) => ok(s, v))).toEqual(good.map(() => true));
  });
  it("HUB-FR-129 · C11 · ApplyReportSchema chặn: head_sha≠null ⇔ pushed; code≠null ⇔ failed (chỉ 4 mã job); conflict_files chỉ khi conflict, ≤ 50; failures ≤ 50; log ≤ 65 536; detail ≤ 300; target null chỉ khi failed", () => {
    const s = schema(internal, "ApplyReportSchema");
    const f = { check: "tests", detail: "x" };
    const bad = [
      applyReport({ head_sha: null }),
      applyReport({ status: "conflict", conflict_files: ["a"] }),
      applyReport({ status: "failed", head_sha: null, code: null }),
      applyReport({ status: "failed", head_sha: null, code: "rate_limited" }),
      applyReport({ status: "failed", head_sha: null, code: "provider_error" }),
      applyReport({ code: "auth" }),
      applyReport({ conflict_files: ["a"] }),
      applyReport({
        status: "conflict",
        head_sha: null,
        conflict_files: Array.from({ length: 51 }, (_, i) => `f${i}`),
      }),
      applyReport({
        status: "check_failed",
        head_sha: null,
        failures: Array.from({ length: 51 }, () => f),
      }),
      applyReport({
        status: "check_failed",
        head_sha: null,
        failures: [f],
        test: { exit_code: 1, duration_ms: 1, log_tail: "x".repeat(65_537) },
      }),
      applyReport({ detail: "x".repeat(301) }),
      applyReport({ target_sha: null }),
      applyReport({ status: "pushed", extra: 1 }),
    ];
    expect(bad.map((v) => ok(s, v))).toEqual(bad.map(() => false));
  });
});

describe("C12–C16 · quyết định + view [plan §3.6, C9–C11]", () => {
  it("HUB-FR-115 · PC2-R08 · C12 · DECISION_REASONS thêm CUỐI apply_conflict, apply_failed; APPLY_ERROR_CODES đúng 8 mã theo thứ tự", () => {
    expect(chat.DECISION_REASONS.slice(-4)).toEqual([
      "autofix_check_failed",
      "sandbox_unavailable",
      "apply_conflict",
      "apply_failed",
    ]);
    expect(ha.APPLY_ERROR_CODES).toEqual([
      "auth",
      "no_credential",
      "push_rejected",
      "network",
      "rate_limited",
      "provider_error",
      "check_failed",
      "unsupported_provider",
    ]);
  });
  it("HUB-FR-129 · HUB-FR-130 · C13 · ApplyStageViewSchema: 7 trạng thái hợp lệ; strict (không `detail`); test_log_file {id,name,mime,size}|null", () => {
    const s = schema(chat, "ApplyStageViewSchema");
    const none = { provider: null, pr_number: null, pr_url: null, head_sha: null };
    const good = [
      applyView(),
      applyView({ auto_merge: "on", mode: "auto_merge" }),
      applyView({ auto_merge: "failed", mode: "auto_merge" }),
      applyView({
        provider: null,
        pr_number: null,
        pr_url: null,
        status: "pushed",
        mode: "branch_only",
      }),
      applyView({
        ...none,
        status: "branch_only",
        mode: "branch_only",
        branch: null,
        target_sha: null,
      }),
      applyView({ ...none, status: "no_changes", branch: null, target_sha: null }),
      applyView({ ...none, status: "conflict", conflict_files: ["src/a.ts"] }),
      applyView({
        ...none,
        status: "check_failed",
        error_code: "check_failed",
        rebased: true,
        failures: [{ check: "tests", detail: "exit 1" }],
        test_log_file: { id: CRED, name: "apply-apply-test.log.txt", mime: "text/plain", size: 10 },
      }),
      applyView({ ...none, status: "failed", error_code: "rate_limited" }),
    ];
    expect(good.map((v) => ok(s, v))).toEqual(good.map(() => true));
    expect(ok(s, applyView({ detail: "Bad credentials" }))).toBe(false);
    expect(ok(s, applyView({ provider: "gitlab" }))).toBe(false);
    expect(ok(s, applyView({ error_code: "boom" }))).toBe(false);
  });
  it("HUB-FR-129 · C11 · C14 · ApplyStageView: status ∈ {failed, check_failed} ⇒ error_code ≠ null; check_failed ⇒ 'check_failed'", () => {
    const s = schema(chat, "ApplyStageViewSchema");
    const none = { provider: null, pr_number: null, pr_url: null, head_sha: null };
    expect(ok(s, applyView({ ...none, status: "failed", error_code: null }))).toBe(false);
    expect(ok(s, applyView({ ...none, status: "check_failed", error_code: null }))).toBe(false);
    expect(ok(s, applyView({ ...none, status: "check_failed", error_code: "auth" }))).toBe(false);
  });
  it("HUB-FR-128 · C7 · C9 · C15 · AutofixStageViewSchema có apply_mode (ApplyMode|null) + apply_base (string|null); StageViewSchema nhận `apply` tuỳ chọn", () => {
    const af = {
      source_key: "app-repo",
      pin_sha: SHA,
      branch: BRANCH,
      round: 1,
      status: "ok",
      diff_stats: { files: 1, insertions: 1, deletions: 1, bytes: 80 },
      diff_file: null,
      test_log_file: null,
      test: { exit_code: 0, duration_ms: 1 },
      failures: [],
      created_at: "2026-10-14T08:00:00.000Z",
    };
    const s = schema(chat, "AutofixStageViewSchema");
    expect(ok(s, { ...af, apply_mode: "pr", apply_base: "main" })).toBe(true);
    expect(ok(s, { ...af, apply_mode: null, apply_base: null })).toBe(true);
    expect(ok(s, { ...af, apply_mode: "branch_only", apply_base: null })).toBe(true);
    expect(ok(s, { ...af, apply_mode: "push", apply_base: null })).toBe(false);
    const sv = schema(chat, "StageViewSchema");
    expect(sv.shape?.apply).toBeDefined();
    expect(sv.shape.apply.safeParse(undefined).success).toBe(true);
    expect(sv.shape.apply.safeParse(applyView()).success).toBe(true);
  });
  it("HUB-FR-115 · C16 · autofixDecisionOptions/view decision: lý do apply_* nằm trong DecisionReason (enum zod nhận)", () => {
    const s = schema(chat, "DecisionReasonSchema");
    expect([ok(s, "apply_conflict"), ok(s, "apply_failed"), ok(s, "apply_x")]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
