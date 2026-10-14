// HUB-BR-14 · PC2-R16 · PC-R14 · C10 · P-c2 · plan §6.6 · test-plan P-c2 §4 T01–T02: cách ly tenant/quyền run cho stage Áp — view run
// (có `apply`) và log test Áp chỉ người có quyền run (runAccess); người lạ cùng tenant + tenant khác ⇒ 404 cùng thân như id không tồn tại.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  applyBody,
  type CtxPc2,
  endApply,
  mkApply,
  needPc2,
  postApply,
  settlePc2,
  stageView,
  startPc2,
  TARGET2,
  toApply,
  waitRunIn,
  Y,
} from "./_support/pc2";

let c: CtxPc2;
beforeAll(async () => {
  c = await startPc2();
  if (!c.pc2) return;
  await mkApply(c, "pc2-t", "gh-priv");
}, 60_000);
afterEach(async () => {
  await settlePc2(c);
});
afterAll(async () => {
  await c?.stop();
});

async function checkFailedRun() {
  const a = await toApply(c, "pc2-t");
  const body = applyBody({
    status: "check_failed",
    head_sha: null,
    rebased: true,
    target_sha: TARGET2,
    failures: [{ check: "tests", detail: "exit 1" }],
    test: { exit_code: 1, duration_ms: 1_000, log_tail: "PC2-TENANT-LOG" },
  });
  expect((await postApply(c, a.aj.id, a.aj.token, body)).status).toBe(201);
  await endApply(c, a.aj);
  await waitRunIn(c, a.runId, ["needs_decision"]);
  const logId = (await stageView(c, "A", a.runId, 1))?.apply?.test_log_file?.id as string;
  return { runId: a.runId, logId };
}

describe("T01–T02 · cách ly [PC2-R16, HUB-BR-14]", () => {
  it("HUB-BR-14 · PC2-R16 · T01 · view run có stage Áp: người lạ cùng tenant (X) + tenant beta (Db, D) ⇒ 404 cùng thân như uuid lạ", async () => {
    needPc2(c);
    const r = await checkFailedRun();
    const ghost = await c.call("X", "GET", `/process-runs/${Y(9999)}`);
    for (const who of ["X", "Db", "D"] as const) {
      const v = await c.call(who, "GET", `/process-runs/${r.runId}`);
      expect({ who, status: v.status, body: v.json }).toEqual({
        who,
        status: 404,
        body: ghost.json,
      });
    }
  }, 45_000);
  it("HUB-BR-14 · PC-R14 · C10 · T02 · log test Áp: A (người bắt đầu run) đọc được; X (lạ cùng tenant), Db (beta) ⇒ 404", async () => {
    needPc2(c);
    const r = await checkFailedRun();
    expect(typeof r.logId).toBe("string");
    for (const who of ["A"] as const) {
      const g = await c.call(who, "GET", `/attachments/${r.logId}/content`);
      expect({ who, status: g.status, text: g.text }).toEqual({
        who,
        status: 200,
        text: "PC2-TENANT-LOG",
      });
    }
    for (const who of ["X", "Db"] as const)
      expect({
        who,
        status: (await c.call(who, "GET", `/attachments/${r.logId}/content`)).status,
      }).toEqual({
        who,
        status: 404,
      });
  }, 45_000);
});
