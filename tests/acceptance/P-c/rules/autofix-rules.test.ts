// HUB-FR-119 · HUB-FR-126 · HUB-FR-127 · HUB-FR-128 · HUB-FR-115 · HUB-BR-31 · HUB-BR-33 · P-c1 · plan §4 Hub
// (`processes/runs/autofix.rules.ts`) · spec §2 PC-R04/R07/R10/R11/R14 · test-plan §3 H01–H10. Module vắng ⇒ đỏ ở `fn()`.
import { describe, expect, it } from "bun:test";
import {
  ATT,
  AUTOFIX,
  fn,
  loadAutofix,
  loadChat,
  loadHub,
  PIN_GIT,
  RUN,
  schema,
  stage,
} from "./_rules";

const m = await loadAutofix();
const chat = await loadChat();
const hub = await loadHub();
const KEY_RE: RegExp = chat.STAGE_KEY_RE;

describe("H01–H04 · nhánh, công cụ, allowlist, phần job", () => {
  it("HUB-FR-128 · E1 · B1 · H01 · autofixBranch(run, stage) = `ai/<run>/<stage>`; đuôi khớp STAGE_KEY_RE", () => {
    const f = fn(m, "autofixBranch");
    for (const key of ["fix", "a", "fix-2", "0", "x".repeat(32)]) {
      const b = f(RUN, key) as string;
      expect(b).toBe(`ai/${RUN}/${key}`);
      expect(KEY_RE.test(b.split("/")[2] ?? "")).toBe(true);
    }
  });
  it("HUB-BR-31 · HUB-BR-33 · PC-R07 · H02 · autofixAllowedTools: có nguồn chỉ-đọc ⇒ [Read,Grep,Glob]; không ⇒ []; không bao giờ Write", () => {
    const f = fn(m, "autofixAllowedTools");
    expect(f(true)).toEqual(["Read", "Grep", "Glob"]);
    expect(f(false)).toEqual([]);
    expect([...f(true), ...f(false)]).not.toContain("Write");
  });
  it("HUB-FR-126 · PC-R04 · H03 · autofixAllowlistUnion: nguồn của stage tự-sửa ⇒ [] (toàn repo); nguồn khác / không tự-sửa ⇒ null", () => {
    const f = fn(m, "autofixAllowlistUnion");
    const stages = [
      stage({ key: "read", sources: [{ source_key: "docs", allowlist: ["docs/**"] }] }),
      stage({ key: "fix", autofix: AUTOFIX }),
    ];
    expect(f(stages, "app-repo")).toEqual([]);
    expect(f(stages, "docs")).toBeNull();
    expect(f([stage({ key: "fix", autofix: null })], "app-repo")).toBeNull();
  });
  it("HUB-FR-126 · HUB-FR-128 · PC-R05 · PC-R11 · H04 · autofixJobPart ⇒ JobAutofix hợp contract (allowlist [], nhánh, vòng, base_patch)", () => {
    const f = fn(m, "autofixJobPart");
    const snap = stage({
      key: "fix",
      autofix: { ...AUTOFIX, install_cmd: "bun install", write_allowlist: ["src/**"] },
    });
    const one = f({
      stage: snap,
      pin: PIN_GIT,
      kind: "git_remote",
      runId: RUN,
      round: 1,
      basePatch: null,
    });
    expect(one).toEqual({
      source: { key: "app-repo", kind: "git_remote", pin: PIN_GIT, allowlist: [] },
      install_cmd: "bun install",
      test_cmd: "bun test",
      write_allowlist: ["src/**"],
      branch: `ai/${RUN}/fix`,
      round: 1,
      base_patch: null,
    });
    const three = f({
      stage: snap,
      pin: PIN_GIT,
      kind: "git_remote",
      runId: RUN,
      round: 3,
      basePatch: ATT,
    });
    expect({ round: three.round, base: three.base_patch, branch: three.branch }).toEqual({
      round: 3,
      base: ATT,
      branch: `ai/${RUN}/fix`,
    });
    const s = schema(hub, "JobAutofixSchema");
    expect([s.safeParse(one).success, s.safeParse(three).success]).toEqual([true, true]);
  });
});

describe("H05–H10 · kết quả job, quyết định, ghi chú làm lại, khớp báo cáo", () => {
  it("HUB-FR-115 · PC-R06 · PC-R10 · H05 · autofixOutcome: container ⇒ sandbox_unavailable; thiếu/check_failed ⇒ autofix_check_failed; ok/no_changes ⇒ continue", () => {
    const f = fn(m, "autofixOutcome");
    const dec = (reason: string) => ({ kind: "decision", reason });
    expect(f(null, "container")).toEqual(dec("sandbox_unavailable"));
    expect(f({ status: "check_failed" }, "container")).toEqual(dec("sandbox_unavailable"));
    expect(f(null, null)).toEqual(dec("autofix_check_failed"));
    expect(f(null, "timeout")).toEqual(dec("autofix_check_failed"));
    expect(f({ status: "check_failed" }, null)).toEqual(dec("autofix_check_failed"));
    expect(f({ status: "ok" }, null)).toEqual({ kind: "continue" });
    expect(f({ status: "no_changes" }, null)).toEqual({ kind: "continue" });
  });
  it("HUB-FR-115 · PC-R10 · H06 · decisionOptionsFor(autofix_*) = [add_attempt, cancel] — KHÔNG use_current", () => {
    const f = fn(m, "decisionOptionsFor");
    expect(f("autofix_check_failed")).toEqual(["add_attempt", "cancel"]);
    expect(f("sandbox_unavailable")).toEqual(["add_attempt", "cancel"]);
    expect(f("job_timeout")).toContain("cancel");
  });
  it("WRK-FR-29 · PC-R10 · H07 · autofixRetryNote: mỗi lỗi một dòng `check path:line rule`; secrets KHÔNG mang detail", () => {
    const note = fn(
      m,
      "autofixRetryNote",
    )([
      {
        check: "secrets",
        path: "src/cfg.ts",
        line: 7,
        rule: "aws_key",
        detail: "AKIAQCQCQCQCQCQCQCQC",
      },
      { check: "tests", detail: "exit 1: 2 failed" },
      { check: "paths", path: ".github/workflows/ci.yml", detail: "đường dẫn cấm" },
    ]) as string;
    const lines = note.split("\n").filter((l) => l.trim().length > 0);
    expect(
      lines.some(
        (l) => l.includes("secrets") && l.includes("src/cfg.ts:7") && l.includes("aws_key"),
      ),
    ).toBe(true);
    expect(lines.some((l) => l.includes("paths") && l.includes(".github/workflows/ci.yml"))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes("tests"))).toBe(true);
    expect(note).not.toContain("AKIAQCQCQCQCQCQCQCQC");
  });
  it("WRK-FR-29 · H08 · autofixRetryNote ≤ 2000 ký tự với 50 lỗi dài; [] (không báo cáo) ⇒ chuỗi không rỗng", () => {
    const f = fn(m, "autofixRetryNote");
    const many = Array.from({ length: 50 }, (_, i) => ({
      check: "paths",
      path: `src/${"d".repeat(200)}/${i}.ts`,
      detail: "x".repeat(500),
    }));
    expect((f(many) as string).length).toBeLessThanOrEqual(2000);
    expect((f([]) as string).trim().length).toBeGreaterThan(0);
  });
  it("HUB-BR-14 · PC-R14 · H09 · reportMatchesJob: nhánh báo cáo = payload.autofix.branch; job không autofix ⇒ false", () => {
    const f = fn(m, "reportMatchesJob");
    const job = { autofix: { branch: `ai/${RUN}/fix` } };
    expect(f({ branch: `ai/${RUN}/fix` }, job)).toBe(true);
    expect(f({ branch: `ai/${RUN}/other` }, job)).toBe(false);
    expect(f({ branch: `ai/${RUN}/fix` }, {})).toBe(false);
  });
});
