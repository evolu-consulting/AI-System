// HUB-FR-115 · HUB-FR-129 · HUB-FR-128 · WRK-FR-29 · E4 · PC2-R04 · R05 · R08 · R16 · C10 · C11 · P-c2 · plan §6.4, §6.6 · test-plan
// P-c2 §4 X01–X09: kết cục job Áp ⇒ "Cần người quyết" — conflict ⇒ apply_conflict; check_failed/failed/thiếu báo cáo ⇒ apply_failed +
// error_code (C11: driver tự ghi hàng failed+provider_error khi không báo cáo); container ⇒ sandbox_unavailable; chỉ add_attempt/cancel
// (use_current ⇒ 409 PROCESS_RUN_STATE); Thêm lượt ⇒ job Áp mới cùng nhánh + bản vá (idempotent); log test sau rebase đọc theo quyền run.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  applyBody,
  applyJobs,
  applyRows,
  type CtxPc2,
  claimApply,
  code,
  decisionOf,
  endApply,
  type Json,
  mkApply,
  needPc2,
  oneApply,
  postApply,
  reportApply,
  runRow,
  settlePc2,
  stageView,
  startPc2,
  TARGET2,
  toApply,
  waitRunIn,
} from "./_support/pc2";

let c: CtxPc2;
beforeAll(async () => {
  c = await startPc2();
  if (!c.pc2) return;
  await mkApply(c, "pc2-x", "gh-priv");
}, 60_000);
afterEach(async () => {
  await settlePc2(c);
});
afterAll(async () => {
  await c?.stop();
});

const OPTS = ["add_attempt", "cancel"];
const decide = (runId: string, option: string) =>
  c.call("A", "POST", `/process-runs/${runId}/decide`, { option });
async function failWith(body: Json) {
  const a = await toApply(c, "pc2-x");
  expect((await postApply(c, a.aj.id, a.aj.token, applyBody(body))).status).toBe(201);
  await endApply(c, a.aj);
  await waitRunIn(c, a.runId, ["needs_decision"]);
  return a;
}

describe("X01–X03 · xung đột + Thêm lượt idempotent [PC2-R04, PC2-R08, Q5]", () => {
  it("HUB-FR-115 · E4 · Q5 · X01 · conflict ⇒ needs_decision apply_conflict, options [add_attempt, cancel]; view apply conflict + file; use_current ⇒ 409 PROCESS_RUN_STATE, giữ needs_decision", async () => {
    needPc2(c);
    const a = await failWith({
      status: "conflict",
      head_sha: null,
      rebased: true,
      target_sha: TARGET2,
      conflict_files: ["src/tong.ts", "src/b.ts"],
    });
    const d = await decisionOf(c.sql, a.runId);
    expect({ reason: d?.reason, options: d?.options }).toEqual({
      reason: "apply_conflict",
      options: OPTS,
    });
    const v = (await stageView(c, "A", a.runId, 1))?.apply;
    expect({ s: v?.status, f: v?.conflict_files, e: v?.error_code, r: v?.rebased }).toEqual({
      s: "conflict",
      f: ["src/tong.ts", "src/b.ts"],
      e: null,
      r: true,
    });
    expect(code(await decide(a.runId, "use_current"))).toEqual({
      status: 409,
      code: "PROCESS_RUN_STATE",
    });
    expect((await runRow(c.sql, a.runId)).status).toBe("needs_decision");
    expect(c.gh.calls()).toHaveLength(0);
  }, 45_000);
  it("HUB-FR-129 · PC2-R06 · PC2-R07 · X02 · Thêm lượt sau xung đột ⇒ job source.apply MỚI (cùng nhánh, cùng bản vá, cùng pin); pushed ⇒ PR mở; 2 hàng autofix_applies", async () => {
    needPc2(c);
    const a = await failWith({
      status: "conflict",
      head_sha: null,
      conflict_files: ["src/tong.ts"],
    });
    expect((await decide(a.runId, "add_attempt")).status).toBe(200);
    const j2 = await claimApply(c, a.runId);
    expect(j2.id).not.toBe(a.aj.id);
    expect({ b: j2.payload.branch, p: j2.payload.patch?.id, pin: j2.payload.pin_sha }).toEqual({
      b: a.aj.payload.branch,
      p: a.aj.payload.patch?.id,
      pin: a.aj.payload.pin_sha,
    });
    await reportApply(c, j2);
    await waitRunIn(c, a.runId, ["done"]);
    expect((await applyRows(c.sql, a.runId)).map((r) => r.status)).toEqual([
      "conflict",
      "pr_opened",
    ]);
    expect((await stageView(c, "A", a.runId, 1))?.apply?.status).toBe("pr_opened");
  }, 60_000);
  it("HUB-FR-115 · X03 · Huỷ ⇒ run cancelled, không job Áp mới", async () => {
    needPc2(c);
    const a = await failWith({
      status: "conflict",
      head_sha: null,
      conflict_files: ["src/tong.ts"],
    });
    expect((await decide(a.runId, "cancel")).status).toBe(200);
    await waitRunIn(c, a.runId, ["cancelled"]);
    expect(await applyJobs(c.sql, a.runId)).toHaveLength(1);
  }, 45_000);
});

describe("X04–X07 · apply_failed theo error_code [PC2-R05, PC2-R08, C10, C11]", () => {
  it("WRK-FR-29 · HUB-BR-33 · PC2-R05 · C10 · X04 · check_failed sau rebase ⇒ apply_failed{check_failed}; view failures + test_log_file; A tải log = log_tail", async () => {
    needPc2(c);
    const fails = [
      { check: "tests", detail: "exit 1: 1 failed" },
      { check: "secrets", path: "src/cfg.ts", line: 3, rule: "aws_key", detail: "khớp mẫu" },
    ];
    const a = await failWith({
      status: "check_failed",
      head_sha: null,
      rebased: true,
      target_sha: TARGET2,
      failures: fails,
      test: { exit_code: 1, duration_ms: 2_000, log_tail: "PC2-LOG 1 fail" },
    });
    const d = await decisionOf(c.sql, a.runId);
    expect({ reason: d?.reason, options: d?.options }).toEqual({
      reason: "apply_failed",
      options: OPTS,
    });
    const v = (await stageView(c, "A", a.runId, 1))?.apply;
    expect({
      s: v?.status,
      e: v?.error_code,
      f: v?.failures,
      has: v?.test_log_file !== null,
    }).toEqual({
      s: "check_failed",
      e: "check_failed",
      f: fails,
      has: true,
    });
    const log = await c.call("A", "GET", `/attachments/${v?.test_log_file?.id}/content`);
    expect([log.status, log.text]).toEqual([200, "PC2-LOG 1 fail"]);
  }, 45_000);
  it.each(["push_rejected", "auth", "network", "no_credential"])(
    "HUB-FR-115 · PC2-R08 · X05 · Runtime failed{%s} ⇒ apply_failed, error_code giữ nguyên (view + hàng)",
    async (codeName) => {
      needPc2(c);
      const a = await failWith({ status: "failed", head_sha: null, code: codeName });
      expect((await decisionOf(c.sql, a.runId))?.reason).toBe("apply_failed");
      expect((await oneApply(c.sql, a.runId)).error_code).toBe(codeName);
      expect((await stageView(c, "A", a.runId, 1))?.apply?.error_code).toBe(codeName);
    },
    45_000,
  );
  it("HUB-FR-115 · C11 · X06 · job kết thúc KHÔNG báo cáo ⇒ apply_failed; driver ghi hàng failed + provider_error (view error_code ≠ null)", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-x");
    await endApply(c, a.aj, { status: "failed", reason: "timeout", code: "TIMEOUT" });
    await waitRunIn(c, a.runId, ["needs_decision"]);
    expect((await decisionOf(c.sql, a.runId))?.reason).toBe("apply_failed");
    const row = await oneApply(c.sql, a.runId);
    expect([row.status, row.error_code]).toEqual(["failed", "provider_error"]);
    expect((await stageView(c, "A", a.runId, 1))?.apply?.error_code).toBe("provider_error");
  }, 45_000);
  it("HUB-FR-127 · WRK-BR-08 · PC2-R08 · X07 · job lỗi reason container (không dựng được container retest) ⇒ sandbox_unavailable, options [add_attempt, cancel]", async () => {
    needPc2(c);
    const a = await toApply(c, "pc2-x");
    await endApply(c, a.aj, { status: "failed", reason: "container", code: "INTERNAL_ERROR" });
    await waitRunIn(c, a.runId, ["needs_decision"]);
    const d = await decisionOf(c.sql, a.runId);
    expect({ reason: d?.reason, options: d?.options }).toEqual({
      reason: "sandbox_unavailable",
      options: OPTS,
    });
  }, 45_000);
});

describe("X08 · task quyết định [HUB-FR-115]", () => {
  it("HUB-FR-115 · PC2-R08 · X08 · task decision apply_* ở /me/review-tasks không có use_current", async () => {
    needPc2(c);
    const a = await failWith({ status: "failed", head_sha: null, code: "auth" });
    const r = await c.call("A", "GET", "/me/review-tasks");
    expect(r.status).toBe(200);
    const items = (r.json?.items ?? []) as Json[];
    const t = items.find(
      (x) =>
        x.process_run_id === a.runId ||
        x.run?.id === a.runId ||
        JSON.stringify(x).includes(a.runId),
    );
    expect(t).toBeDefined();
    expect(JSON.stringify(t)).not.toContain("use_current");
  }, 45_000);
});
