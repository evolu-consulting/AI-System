// AC-H41 · HUB-FR-144 · HUB-BR-42 · TZ-R04 · test-plan-int §3 PD-I20…I22, PD-I25…I29, PD-I33: stage `wait_until` vào
// chờ (hẹn + múi giờ tenant lúc lưu), chưa tới hạn không đổi, `timer_invalid` + quyết, hạn đã qua, bước song song.
// PD-I23 (khởi động lại) ở `wait-restart.int`, PD-I24 ở `race.int`, PD-I34…I36 ở `wait-def.int`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  agentStage,
  type CtxPd,
  decide,
  defBody,
  FIELD_NGAY,
  G1,
  type Json,
  jobDone,
  mdOut,
  needPdSchema,
  PD_DEFS,
  runRow,
  startPd,
  startRun,
  sweepN,
  timersOf,
  viewRun,
  waitFor,
  waitStageStatus,
  waitStatus,
} from "../_support/pd";
import {
  ensureDef,
  hubRunsOfStage,
  jobOfStage,
  setTz,
  settle,
  stageId,
  stageOutputs,
  startWait,
  waitDefVariant,
  waitMd,
} from "./_wait";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd();
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const HCM = "Asia/Ho_Chi_Minh";
const FIELDS = { ngay_het_han: "2026-11-20" };
const DUE = "2026-11-17T02:00:00.000Z";
const NAME_WAIT = "Chờ hạn"; // tên stage `waitStage` mặc định (pd.ts)

/** Run tới `needs_decision` `timer_invalid` (stage 1). */
async function toInvalid(fields?: Json, def?: Json): Promise<string> {
  const { runId } = await startWait(c, { fields, def });
  const run = await waitStatus(c.sql, runId, "needs_decision");
  expect(run.decision?.reason).toBe("timer_invalid");
  await waitStageStatus(c.sql, runId, 1, "needs_decision");
  return runId;
}

describe("PD-I20…I29 · stage wait_until [AC-H41][HUB-FR-144]", () => {
  it("AC-H41 · PD-I20 · fields 2026-11-20 ⇒ stage + run waiting_timer, 0 job s1, hẹn 2026-11-17T02:00Z HCM, view wait + executor", async () => {
    needPdSchema(c.pd);
    const { runId } = await startWait(c, { fields: FIELDS });
    const s1 = await waitStageStatus(c.sql, runId, 1, "waiting_timer");
    expect(s1.started_at).not.toBeNull();
    await waitStatus(c.sql, runId, "waiting_timer");
    expect(await hubRunsOfStage(c.sql, runId, 1)).toBe(0);
    const sr = await stageId(c.sql, runId, 1);
    const ts = await timersOf(c.sql, runId);
    expect(ts.length).toBe(1);
    expect(ts[0]).toMatchObject({ kind: "wait_until", stage_run_id: sr, timezone: HCM });
    expect(ts[0]?.fired_at).toBeNull();
    expect(new Date(ts[0]?.due_at).toISOString()).toBe(DUE);
    expect(ts[0]?.idempotency_key).toMatch(new RegExp(`^wait_until:${sr}:\\d+:\\d+:1$`));
    const v = await viewRun(c, "A", runId);
    expect(v.status).toBe(200);
    expect(v.json?.stages?.[1]?.wait).toEqual({ due_at: DUE, timezone: HCM });
    expect(v.json?.stages?.[1]?.status).toBe("waiting_timer");
    expect(v.json?.stages?.[1]?.executor).toEqual({
      kind: "wait_until",
      key: "wait_until",
      name: { vi: "Chờ tới ngày", en: "Wait until date" },
    });
  }, 60_000);

  it("TZ-R04 · PD-I21 · tenant Europe/Berlin, clock 2026-03-01: 2026-04-01 ⇒ 2026-03-29T07:00Z (CEST); 2026-03-31 ⇒ 2026-03-28T08:00Z (CET)", async () => {
    needPdSchema(c.pd);
    await setTz(c.sql, "Europe/Berlin");
    try {
      const at = new Date("2026-03-01T03:00:00Z");
      const cases: [string, string][] = [
        ["2026-04-01", "2026-03-29T07:00:00.000Z"],
        ["2026-03-31", "2026-03-28T08:00:00.000Z"],
      ];
      for (const [day, due] of cases) {
        const { runId } = await startWait(c, { fields: { ngay_het_han: day }, at });
        await waitStageStatus(c.sql, runId, 1, "waiting_timer");
        const ts = await timersOf(c.sql, runId);
        expect({ day, n: ts.length, tz: ts[0]?.timezone }).toEqual({
          day,
          n: 1,
          tz: "Europe/Berlin",
        });
        expect({ day, due: new Date(ts[0]?.due_at).toISOString() }).toEqual({ day, due });
      }
    } finally {
      await setTz(c.sql, HCM);
    }
  }, 60_000);

  it("TZ-R04 · PD-I22 · sau khi vào chờ, đổi timezone acme = Europe/Berlin ⇒ due_at + timezone hẹn giữ nguyên", async () => {
    needPdSchema(c.pd);
    const { runId } = await startWait(c, { fields: FIELDS });
    await waitStageStatus(c.sql, runId, 1, "waiting_timer");
    const before = (await timersOf(c.sql, runId))[0];
    await setTz(c.sql, "Europe/Berlin");
    try {
      await sweepN(c, 1);
      const after = await timersOf(c.sql, runId);
      expect(after.length).toBe(1);
      expect({
        due: new Date(after[0]?.due_at).toISOString(),
        tz: after[0]?.timezone,
        fired: after[0]?.fired_at,
      }).toEqual({ due: new Date(before?.due_at).toISOString(), tz: HCM, fired: null });
      const v = await viewRun(c, "A", runId);
      expect(v.json?.stages?.[1]?.wait).toEqual({ due_at: DUE, timezone: HCM });
    } finally {
      await setTz(c.sql, HCM);
    }
  }, 60_000);

  it("AC-H41 · PD-I25 · trước hạn 1 phút `sweep` × 2 ⇒ không đổi gì (hẹn mở, stage waiting_timer, 0 output s1)", async () => {
    needPdSchema(c.pd);
    const { runId } = await startWait(c, { fields: FIELDS });
    await waitStageStatus(c.sql, runId, 1, "waiting_timer");
    c.clk.set(new Date(new Date(DUE).getTime() - 60_000));
    await sweepN(c, 2);
    const ts = await timersOf(c.sql, runId);
    expect(ts.map((t) => [t.fired_at, t.cancelled_at])).toEqual([[null, null]]);
    expect((await waitStageStatus(c.sql, runId, 1, "waiting_timer")).status).toBe("waiting_timer");
    expect((await runRow(c.sql, runId)).status).toBe("waiting_timer");
    expect((await stageOutputs(c.sql, runId, 1)).length).toBe(0);
    expect(await hubRunsOfStage(c.sql, runId, 2)).toBe(0);
  }, 60_000);

  it("AC-H41 · PD-I26 · timer_invalid: (a) thiếu field; (b) ttl 7 + ngày +30 (quá expires_at); (c) ttl null + ngày +800 ⇒ needs_decision, 0 hẹn, 3 lựa chọn", async () => {
    needPdSchema(c.pd);
    const runs = [
      await toInvalid(undefined),
      await toInvalid({ ngay_het_han: "2026-12-01" }, waitDefVariant("pd-wait-ttl7", 7)),
      await toInvalid({ ngay_het_han: "2029-01-10" }, waitDefVariant("pd-wait-ttlnull", null)),
    ];
    for (const [i, runId] of runs.entries()) {
      const run = await runRow(c.sql, runId);
      expect({ i, reason: run.decision?.reason, options: run.decision?.options }).toEqual({
        i,
        reason: "timer_invalid",
        options: ["add_attempt", "use_current", "cancel"],
      });
      expect({ i, timers: (await timersOf(c.sql, runId)).length }).toEqual({ i, timers: 0 });
    }
  }, 90_000);

  it("AC-H41 · PD-I27 · (a) ⇒ B quyết bị chặn; A `use_current` ⇒ s1 done, output .md 'Bỏ chờ theo quyết định.', s2 có job", async () => {
    needPdSchema(c.pd);
    const runId = await toInvalid(undefined);
    const b = await decide(c, "B", runId, "use_current");
    expect([403, 404]).toContain(b.status);
    const a = await decide(c, "A", runId, "use_current");
    expect(a.status).toBe(200);
    await waitStageStatus(c.sql, runId, 1, "done");
    const outs = await stageOutputs(c.sql, runId, 1);
    expect(outs.map((o) => o.content)).toEqual([waitMd(NAME_WAIT, "Bỏ chờ theo quyết định.")]);
    await jobOfStage(c, runId, 2);
    expect(await hubRunsOfStage(c.sql, runId, 1)).toBe(0);
  }, 60_000);

  it("AC-H41 · PD-I28 · (a) ⇒ sửa output s0 (thêm field) ⇒ Adm `add_attempt` ⇒ đúng 1 hẹn wait_until mới, không 23505", async () => {
    needPdSchema(c.pd);
    const runId = await toInvalid(undefined);
    await c.sql`update hub.process_outputs set fields = ${c.sql.json(FIELDS)}
      where process_run_id = ${runId} and stage_idx = 0`;
    const r = await decide(c, "Adm", runId, "add_attempt");
    expect({ status: r.status, code: r.json?.error?.code ?? null }).toEqual({
      status: 200,
      code: null,
    });
    await waitStageStatus(c.sql, runId, 1, "waiting_timer");
    const sr = await stageId(c.sql, runId, 1);
    const ts = await timersOf(c.sql, runId);
    expect(ts.length).toBe(1);
    expect(ts[0]).toMatchObject({ kind: "wait_until", stage_run_id: sr, timezone: HCM });
    expect(new Date(ts[0]?.due_at).toISOString()).toBe(DUE);
    // plan-addendum Q9: n = số hẹn cùng kind của stage + 1 ⇒ hẹn đầu tiên của stage = 1 (test-plan-int ghi `:2`, xem báo cáo).
    expect(ts[0]?.idempotency_key).toMatch(new RegExp(`^wait_until:${sr}:\\d+:\\d+:1$`));
  }, 60_000);

  it("AC-H41 · PD-I29 · ngày đã qua (hạn ≤ now) ⇒ hàng hẹn vẫn ghi; `sweep` kế ⇒ s1 done (D-PD09)", async () => {
    needPdSchema(c.pd);
    const { runId } = await startWait(c, { fields: { ngay_het_han: "2026-10-31" } });
    const sr = await stageId(c.sql, runId, 1);
    const ts0 = (await waitFor(
      () => timersOf(c.sql, runId),
      (t) => t.length > 0,
      8_000,
    )) as Json[];
    expect(ts0.map((t) => [t.kind, t.stage_run_id])).toEqual([["wait_until", sr]]);
    expect(new Date(ts0[0]?.due_at).toISOString()).toBe("2026-10-28T02:00:00.000Z");
    await sweepN(c, 1);
    await waitStageStatus(c.sql, runId, 1, "done", 0);
    expect((await timersOf(c.sql, runId))[0]?.fired_at).not.toBeNull();
    await jobOfStage(c, runId, 2);
  }, 60_000);
});

describe("PD-I33 · bước song song wait_until + agent [AC-H41][readiness #20]", () => {
  it("AC-H41 · PD-I33 · agent running ⇒ run running; agent done ⇒ run waiting_timer; backoff retry + waiting_review ⇒ run running", async () => {
    needPdSchema(c.pd);
    const par = await startWait(c, { fields: FIELDS, def: { ...PD_DEFS.parWait(), ttl_days: 30 } });
    await waitStageStatus(c.sql, par.runId, 1, "waiting_timer");
    const song = await jobOfStage(c, par.runId, 2);
    expect((await runRow(c.sql, par.runId)).status).toBe("running");
    await jobDone(c, song, mdOut());
    await waitStageStatus(c.sql, par.runId, 2, "done");
    await waitStatus(c.sql, par.runId, "waiting_timer");

    await settle(c.sql);
    const rv = defBody("pd-par-rv", [
      agentStage({ key: "doc", step: 0, fields: FIELD_NGAY }),
      agentStage({
        key: "duyet",
        step: 1,
        after: { kind: "review", group_id: G1, back_to_steps: [] },
      }),
      agentStage({ key: "song", step: 1 }),
    ]);
    await ensureDef(c, rv);
    const runId = await startRun(c, "pd-par-rv");
    await jobDone(c, await jobOfStage(c, runId, 0), mdOut());
    const jd = await jobOfStage(c, runId, 1);
    const js = await jobOfStage(c, runId, 2);
    await c.rt.fail(js, "UPSTREAM_ERROR" as never, "lỗi tạm");
    await waitStageStatus(c.sql, runId, 2, "waiting_timer");
    await jobDone(c, jd, mdOut());
    await waitStageStatus(c.sql, runId, 1, "waiting_review");
    expect((await runRow(c.sql, runId)).status).toBe("running");
  }, 90_000);
});
