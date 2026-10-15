// HUB-FR-138 · HUB-FR-139 · HUB-FR-129 · HUB-FR-128 · FB1-AC-15 (reviewer Blocker): dưới `driver=filebox`, các đường GHI output của quy trình tự-sửa
// phải lưu `filebox_file_id/version_id` (INSERT-trước/stage-sau ⇒ cột được ghi sau khi stage) để ĐỌC LẠI ra đúng byte (không 404) và không
// để file mồ côi ở FileBox: (a) autofix diff, (b) autofix test-log (internal/autofix), (c) apply test-log (internal/apply), (d) process output
// (`commitOutputBlob`). Hub thật + Runtime giả P-c2 (`startPc2({storage})`) + FileBox giả.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { outputs } from "../P-a/pf1/_local";
import {
  applyBody,
  type CtxPc2,
  claimApply,
  type Json,
  mkApply,
  needPc2,
  oneApply,
  passGate,
  postApply,
  settlePc2,
  startPc2,
  toGate,
} from "../P-c2/_support/pc2";
import { buildFbStorage, type FbFake, needFb, startFbFake } from "./_fb1";
import { expectFbReadable, expectNoFbGaps } from "./_fbout";

let c: CtxPc2;
let fake: FbFake;

beforeAll(async () => {
  fake = startFbFake();
  const { storage, error } = await buildFbStorage({ fake });
  expect({ driver: error }).toEqual({ driver: null });
  c = await startPc2({ storage: storage ?? undefined });
  if (!c.pc2) return;
  await mkApply(c, "fb-out", "gh-priv");
}, 60_000);
afterEach(async () => {
  await settlePc2(c);
});
afterAll(async () => {
  await c?.stop();
  await fake?.close();
});

const reader = async () => ({ sql: c.sql, fake, base: c.base, token: await c.tok("A") });
const LOG = "12 pass\n0 fail";

describe("FB1-AC-15 · đường ghi output đọc lại được dưới driver filebox [HUB-FR-138 · HUB-FR-139]", () => {
  it("HUB-FR-138 · FB1-AC-15 · u1 · autofix-result: diff + test-log đều có filebox_file_id, đọc lại 200 đúng byte (diff chứa nội dung báo cáo), không mồ côi", async () => {
    await needFb(c.sql);
    needPc2(c);
    const before = new Set(fake.ids());
    const g = await toGate(c, "fb-out");
    const [af] = await c.sql<
      { j: Json }[]
    >`select to_jsonb(a) as j from hub.autofix_results a where a.process_run_id = ${g.runId}`;
    const attIds = Object.entries(af?.j ?? {})
      .filter(([k, v]) => /attachment_id$/.test(k) && v)
      .map(([k, v]) => [k, v as string] as const);
    expect(attIds.map(([k]) => k)).toContain("diff_attachment_id");
    expect(attIds.length).toBeGreaterThanOrEqual(2); // diff + log test
    const o = await reader();
    for (const [k, id] of attIds) await expectFbReadable(o, id, `autofix.${k}`);
    const diff = attIds.find(([k]) => k === "diff_attachment_id")?.[1] ?? "";
    const res = await fetch(`${c.base}/attachments/${diff}/content`, {
      headers: { authorization: `Bearer ${o.token}`, "sec-fetch-mode": "cors" },
    });
    expect(await res.text()).toContain("diff --git a/src/tong.ts b/src/tong.ts");
    await expectNoFbGaps(c.sql, fake, before);
  }, 60_000);

  it("HUB-FR-138 · FB1-AC-15 · u2 · process output của stage (commitOutputBlob): mọi process_outputs.attachment_id có filebox_file_id, đọc lại 200 đúng byte, không mồ côi", async () => {
    await needFb(c.sql);
    needPc2(c);
    const before = new Set(fake.ids());
    const g = await toGate(c, "fb-out");
    const outs = (await outputs(c.sql, g.runId)).filter((r) => r.attachment_id);
    expect(outs.length).toBeGreaterThanOrEqual(1);
    const o = await reader();
    for (const r of outs)
      await expectFbReadable(o, r.attachment_id, `process_output.stage${r.stage_idx}`);
    await expectNoFbGaps(c.sql, fake, before);
  }, 60_000);

  it("HUB-FR-138 · FB1-AC-15 · u3 · apply-result có test: test_log_attachment_id có filebox_file_id, đọc lại 200 đúng byte (text/plain), không mồ côi", async () => {
    await needFb(c.sql);
    needPc2(c);
    const before = new Set(fake.ids());
    const g = await toGate(c, "fb-out");
    await passGate(c, g);
    const aj = await claimApply(c, g.runId);
    const r = await postApply(
      c,
      aj.id,
      aj.token,
      applyBody({ test: { exit_code: 0, duration_ms: 3_400, log_tail: LOG } }),
    );
    expect(r.status).toBe(201);
    const row = await oneApply(c.sql, g.runId);
    const att = await expectFbReadable(
      await reader(),
      row.test_log_attachment_id,
      "apply.test_log",
    );
    expect(att.mime).toBe("text/plain");
    await expectNoFbGaps(c.sql, fake, before);
  }, 60_000);

  it("HUB-FR-138 · FB1-AC-15 · u4 · apply-result lần 2 (409 APPLY_RESULT_EXISTS) không để file mồ côi ở FileBox", async () => {
    await needFb(c.sql);
    needPc2(c);
    const before = new Set(fake.ids());
    const g = await toGate(c, "fb-out");
    await passGate(c, g);
    const aj = await claimApply(c, g.runId);
    const body = applyBody({ test: { exit_code: 0, duration_ms: 10, log_tail: "ok" } });
    expect((await postApply(c, aj.id, aj.token, body)).status).toBe(201);
    expect((await postApply(c, aj.id, aj.token, body)).status).toBe(409);
    await expectNoFbGaps(c.sql, fake, before);
  }, 60_000);
});
