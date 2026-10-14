// HUB-FR-129 · HUB-FR-130 · HUB-FR-115 · HUB-BR-34 · HUB-BR-30 · P-c2 · plan §4 Hub (`processes/runs/apply.rules.ts`) · spec §2
// PC2-R03, R07–R09, R11, R14, R15 · test-plan P-c2 §4 H01–H13. Module vắng ⇒ đỏ ở `fn()`.
import { describe, expect, it } from "bun:test";
import {
  fn,
  GH_URL,
  loadApply,
  loadAutofix,
  loadCoreTask,
  PATCH,
  RUN,
  SECRET,
  SRC_ID,
  X,
} from "./_rules2";

const m = await loadApply();
const DIFF_OK = { status: "ok", diff: PATCH };

describe("H01–H02 · kế hoạch + kết cục Áp [PC2-R03, PC2-R08]", () => {
  it("HUB-BR-34 · PC2-R03 · Q4 · H01 · applyPlan: null/check_failed/ok thiếu diff ⇒ invalid; no_changes ⇒ no_changes; local ⇒ branch_only; git ⇒ job (pushOnly = branch_only)", () => {
    const f = fn(m, "applyPlan");
    const p = (result: unknown, sourceKind: string, mode: string) =>
      f({ result, sourceKind, mode });
    expect(p(null, "git_remote", "pr")).toEqual({ kind: "invalid" });
    expect(p({ status: "check_failed", diff: null }, "git_remote", "pr")).toEqual({
      kind: "invalid",
    });
    expect(p({ status: "ok", diff: null }, "git_remote", "pr")).toEqual({ kind: "invalid" });
    expect(p({ status: "no_changes", diff: null }, "git_remote", "pr")).toEqual({
      kind: "no_changes",
    });
    expect(p({ status: "no_changes", diff: null }, "local_path", "branch_only")).toEqual({
      kind: "no_changes",
    });
    expect(p(DIFF_OK, "local_path", "branch_only")).toEqual({ kind: "branch_only" });
    expect(p(DIFF_OK, "git_remote", "pr")).toEqual({ kind: "job", pushOnly: false });
    expect(p(DIFF_OK, "git_remote", "auto_merge")).toEqual({ kind: "job", pushOnly: false });
    expect(p(DIFF_OK, "git_remote", "branch_only")).toEqual({ kind: "job", pushOnly: true });
  });
  it("HUB-FR-115 · PC2-R08 · H02 · applyOutcome: container thắng ⇒ sandbox; thiếu báo cáo/lỗi job ⇒ apply_failed(code ?? provider_error); conflict ⇒ apply_conflict; check_failed/failed ⇒ apply_failed; pushed ⇒ provider | done", () => {
    const f = fn(m, "applyOutcome");
    const dec = (reason: string, code: string | null) => ({ kind: "decision", reason, code });
    expect(f(null, "container", false)).toMatchObject({
      kind: "decision",
      reason: "sandbox_unavailable",
    });
    expect(f({ status: "pushed", code: null }, "container", false)).toMatchObject({
      kind: "decision",
      reason: "sandbox_unavailable",
    });
    expect(f(null, null, false)).toEqual(dec("apply_failed", "provider_error"));
    expect(f(null, "timeout", true)).toEqual(dec("apply_failed", "provider_error"));
    expect(f({ status: "failed", code: "auth" }, "timeout", false)).toEqual(
      dec("apply_failed", "auth"),
    );
    expect(f({ status: "conflict", code: null }, null, false)).toEqual(dec("apply_conflict", null));
    expect(f({ status: "check_failed", code: null }, null, false)).toEqual(
      dec("apply_failed", "check_failed"),
    );
    expect(f({ status: "failed", code: "push_rejected" }, null, false)).toEqual(
      dec("apply_failed", "push_rejected"),
    );
    expect(f({ status: "pushed", code: null }, null, false)).toEqual({ kind: "provider" });
    expect(f({ status: "pushed", code: null }, null, true)).toEqual({ kind: "done" });
  });
});

describe("H03–H04 · GitHub [PC2-R07, PC2-R09]", () => {
  it("HUB-FR-129 · H03 · githubRepoOf: /<owner>/<repo>[.git] (ký tự [A-Za-z0-9_.-] ≤ 100); sai hình ⇒ null", () => {
    const f = fn(m, "githubRepoOf");
    expect(f(GH_URL)).toEqual({ owner: "pc2-test", repo: "app-repo" });
    expect(f("https://github.com/pc2-test/app-repo")).toEqual({
      owner: "pc2-test",
      repo: "app-repo",
    });
    expect(f("https://github.com/a_b.c/x-y.z.git")).toEqual({ owner: "a_b.c", repo: "x-y.z" });
    for (const u of [
      "https://github.com/onlyowner",
      "https://github.com/a/b/c",
      `https://github.com/${"o".repeat(101)}/r.git`,
      "https://github.com/a%2Fb/r",
      "https://github.com/a/r$x",
      "không phải url",
    ])
      expect({ u, r: f(u) }).toEqual({ u, r: null });
  });
  it("HUB-BR-30 · PC2-R09 · H04 · mapProviderError: 401 ⇒ auth; 403/404 khác ⇒ auth; rate limit ≤ 60 s ⇒ retry(waitMs), > 60 s ⇒ rate_limited; 422 exists ⇒ exists, 422 khác ⇒ provider_error; 5xx ⇒ retry | provider_error", () => {
    const f = fn(m, "mapProviderError");
    const now = 1_760_000_000_000;
    const i = (o: Record<string, unknown>) => ({
      status: 500,
      retryAfter: null,
      rateRemaining: null,
      rateReset: null,
      nowMs: now,
      body422AlreadyExists: false,
      ...o,
    });
    const fail = (code: string) => ({ kind: "fail", code });
    expect(f(i({ status: 401 }))).toEqual(fail("auth"));
    expect(f(i({ status: 403, rateRemaining: "12" }))).toEqual(fail("auth"));
    expect(f(i({ status: 404 }))).toEqual(fail("auth"));
    const r403 = f(
      i({ status: 403, rateRemaining: "0", rateReset: String((now + 30_000) / 1000) }),
    );
    expect(r403.kind).toBe("retry");
    expect(Math.abs(r403.waitMs - 30_000)).toBeLessThanOrEqual(1_000);
    expect(
      f(i({ status: 403, rateRemaining: "0", rateReset: String((now + 120_000) / 1000) })),
    ).toEqual(fail("rate_limited"));
    expect(f(i({ status: 429, retryAfter: "5" }))).toEqual({ kind: "retry", waitMs: 5_000 });
    expect(f(i({ status: 429, retryAfter: "60" }))).toEqual({ kind: "retry", waitMs: 60_000 });
    expect(f(i({ status: 429, retryAfter: "61" }))).toEqual(fail("rate_limited"));
    expect(f(i({ status: 422, body422AlreadyExists: true }))).toEqual({ kind: "exists" });
    expect(f(i({ status: 422 }))).toEqual(fail("provider_error"));
    for (const status of [500, 502, 503]) {
      const r = f(i({ status }));
      expect({
        status,
        ok: r.kind === "retry" || (r.kind === "fail" && r.code === "provider_error"),
      }).toEqual({
        status,
        ok: true,
      });
    }
  });
});

describe("H05–H08 · nội dung PR + output [PC2-R14, PC2-R15]", () => {
  const OUT = [
    "## Bảng ý",
    "Ý riêng KHÔNG-VÀO-PR",
    "",
    "## Thay đổi",
    `Sửa dấu cộng ở src/tong.ts. Khoá cũ ${SECRET} và ghp_${"a1B2".repeat(9)}`,
    "",
    "## Test",
    "12 pass · 0 fail",
    "",
    "## Bàn giao",
    "Ghi chú nội bộ BAN-GIAO-RIENG",
  ].join("\n");
  it("HUB-BR-30 · PC2-R14 · Q7 · H05 · prTitle = `[AI] <quy trình> · <stage> (<8 ký tự run>)`; ≤ 256, cắt tên quy trình trước", () => {
    const f = fn(m, "prTitle");
    expect(f("Sửa lỗi tự áp (PR)", "Sửa lỗi", RUN)).toBe(
      `[AI] Sửa lỗi tự áp (PR) · Sửa lỗi (${RUN.slice(0, 8)})`,
    );
    const long = f("Q".repeat(400), "Sửa lỗi", RUN) as string;
    expect(long.length).toBeLessThanOrEqual(256);
    expect(long.startsWith("[AI] Q")).toBe(true);
    expect(long.endsWith(` · Sửa lỗi (${RUN.slice(0, 8)})`)).toBe(true);
  });
  it("HUB-BR-30 · PC2-R14 · H06 · prBody: chỉ `## Thay đổi` + `## Test` (che bí mật) + chân `Tạo bởi AI System · run <id> · vòng <k>`; không mục khác", () => {
    const b = fn(m, "prBody")(OUT, RUN, 2) as string;
    expect(b).toContain("## Thay đổi");
    expect(b).toContain("Sửa dấu cộng ở src/tong.ts.");
    expect(b).toContain("## Test");
    expect(b).toContain("12 pass · 0 fail");
    expect(b).toContain(`Tạo bởi AI System · run ${RUN} · vòng 2`);
    for (const no of [
      SECRET,
      `ghp_${"a1B2".repeat(9)}`,
      "KHÔNG-VÀO-PR",
      "BAN-GIAO-RIENG",
      "## Bảng ý",
    ])
      expect({ no, has: b.includes(no) }).toEqual({ no, has: false });
  });
  it("HUB-BR-30 · PC2-R14 · H07 · prBody: phần nội dung ≤ 8 000 ký tự kể cả output rất dài; output null ⇒ vẫn có chân", () => {
    const f = fn(m, "prBody");
    const big = `## Thay đổi\n${"x".repeat(20_000)}\n\n## Test\n${"y".repeat(20_000)}\n`;
    const footer = `Tạo bởi AI System · run ${RUN} · vòng 1`;
    const b = f(big, RUN, 1) as string;
    expect(b).toContain(footer);
    expect(b.length).toBeLessThanOrEqual(8_000 + footer.length + 8);
    expect(f(null, RUN, 1) as string).toContain(footer);
  });
  it("PC2-R15 · H08 · prUrlOk: chỉ https + host = webHost", () => {
    const f = fn(m, "prUrlOk");
    expect(f("https://github.com/pc2-test/app-repo/pull/1", "github.com")).toBe(true);
    expect(f("https://ghe.local/a/b/pull/2", "ghe.local")).toBe(true);
    for (const u of [
      "http://github.com/pc2-test/app-repo/pull/1",
      "https://evil.example/pull/1",
      "https://github.com.evil.io/a/b/pull/1",
      "javascript:alert(1)",
      "//github.com/a/b/pull/1",
      "",
    ])
      expect({ u, ok: f(u, "github.com") }).toEqual({ u, ok: false });
  });
  it("HUB-FR-130 · H09 · applyOutputMd: luôn có `## Kết quả áp`; pr_opened có URL PR + nhánh; local branch_only có hướng dẫn `git apply`", () => {
    const f = fn(m, "applyOutputMd");
    const base = {
      mode: "pr",
      status: "pr_opened",
      branch: `ai/${RUN}/fix`,
      head_sha: "b".repeat(40),
      target_sha: "a".repeat(40),
      rebased: false,
      pr_url: "https://github.com/pc2-test/app-repo/pull/42",
      pr_number: 42,
      auto_merge: null,
    };
    const pr = f(base) as string;
    expect(pr).toContain("## Kết quả áp");
    expect(pr).toContain("https://github.com/pc2-test/app-repo/pull/42");
    expect(pr).toContain(`ai/${RUN}/fix`);
    const local = f({
      ...base,
      mode: "branch_only",
      status: "branch_only",
      branch: null,
      head_sha: null,
      target_sha: null,
      pr_url: null,
      pr_number: null,
    }) as string;
    expect(local).toContain("## Kết quả áp");
    expect(local).toContain("git apply");
    expect(f({ ...base, status: "no_changes", pr_url: null, pr_number: null }) as string).toContain(
      "## Kết quả áp",
    );
  });
});

describe("H10–H13 · kênh khoá + quyết định [PC2-R11, PC2-R08]", () => {
  it("HUB-BR-30 · H10 · credentialUsername: github ⇒ x-access-token; null (host khác) ⇒ oauth2", () => {
    const f = fn(m, "credentialUsername");
    expect([f("github"), f(null)]).toEqual(["x-access-token", "oauth2"]);
  });
  it("HUB-BR-30 · PC2-R11 · H11 · credentialJobAllows: chỉ job running loại source.apply (nguồn = source) / source.resolve (nguồn ∈ items)", () => {
    const f = fn(m, "credentialJobAllows");
    const other = X(99);
    const apply = { type: "source.apply", status: "running", source: { source_id: SRC_ID } };
    expect([f(apply, SRC_ID), f(apply, other)]).toEqual([true, false]);
    expect(f({ ...apply, status: "queued" }, SRC_ID)).toBe(false);
    expect(f({ ...apply, status: "succeeded" }, SRC_ID)).toBe(false);
    const res = {
      type: "source.resolve",
      status: "running",
      items: [{ source_id: other }, { source_id: SRC_ID }],
    };
    expect([f(res, SRC_ID), f(res, X(98))]).toEqual([true, false]);
    expect(
      f({ type: "agent.cli", status: "running", items: [{ source_id: SRC_ID }] }, SRC_ID),
    ).toBe(false);
    expect(
      f({ type: "workflow.async", status: "running", source: { source_id: SRC_ID } }, SRC_ID),
    ).toBe(false);
  });
  it("HUB-FR-115 · PC2-R08 · H12 · autofixDecisionOptions: apply_conflict/apply_failed ⇒ [add_attempt, cancel] (không use_current)", async () => {
    const f = fn(await loadAutofix(), "autofixDecisionOptions");
    expect(f("apply_conflict")).toEqual(["add_attempt", "cancel"]);
    expect(f("apply_failed")).toEqual(["add_attempt", "cancel"]);
  });
  it("HUB-FR-115 · PC2-R08 · H13 · core decisionOptionsFor(hasOutput, apply_*) = [add_attempt, cancel] kể cả hasOutput=true", async () => {
    const f = fn(await loadCoreTask(), "decisionOptionsFor");
    expect(f(true, "apply_failed")).toEqual(["add_attempt", "cancel"]);
    expect(f(true, "apply_conflict")).toEqual(["add_attempt", "cancel"]);
  });
});
