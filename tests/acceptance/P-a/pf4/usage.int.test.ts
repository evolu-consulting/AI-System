// HUB-FR-117 · AC-H34 · ADM-FR-67 · C5 · Q4 · P4-01…P4-06 (test-plan-int §5; plan §6; plan-contract §2 `ProcessRunUsage`, §3
// `GET /process-runs/:id/usage`). Fixture SQL usage (không cần PF1). P4-07 ⇢PF1 ở `usage-real.int.test.ts`. Đỏ ở `needSchema`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { api } from "../../X2a/_x2a";
import { type CtxPa, type Json, PA, startHubPa, startPa, T } from "../_support/pa";
import { needSchema } from "../_support/schema";
import { insertAttempt, seedUsageDef, type UsageFix, usageRun, usageSum } from "./_local";

let c: CtxPa;
let f: UsageFix;
beforeAll(async () => {
  c = await startPa();
  if (!c.ready) return;
  await seedUsageDef(c);
  f = await usageRun(c);
}, 60_000);
afterAll(async () => {
  await c?.stop();
});
const usage = (r: Parameters<CtxPa["call"]>[0], id: string, qs = "") =>
  c.call(r, "GET", `/process-runs/${id}/usage${qs}`);

describe("P4-01, P4-02 · token theo run [AC-H34, C5]", () => {
  it("AC-H34 · P4-01 · A ⇒ detail=full; totals.total = Σ usage_logs; stage 0 attempts=2; stage 1 team_runs[0].calls 4 (model, latency_ms, member_key, role)", async () => {
    needSchema(c.ready);
    const r = await usage("A", f.run.runId);
    expect(r.status).toBe(200);
    const { ProcessRunUsageSchema: S } = (await import("@ai/contracts/chat")) as Json;
    expect(S?.safeParse?.(r.json)?.success).toBe(true);
    expect(r.json?.detail).toBe("full");
    const sum = await usageSum(c, f.run.runId);
    expect(r.json?.totals?.total).toBe(sum.total);
    expect(r.json?.totals?.total).toBe(f.total);
    expect(r.json?.totals?.calls).toBe(6);
    const [s0, s1] = r.json?.stages ?? [];
    expect(s0?.attempts).toBe(2);
    expect(s0?.calls?.length).toBe(2);
    const calls = s1?.team_runs?.[0]?.calls ?? [];
    expect(s1?.team_runs?.[0]?.id).toBe(f.teamRunId);
    expect(calls.length).toBe(4);
    expect(calls.map((x: Json) => x.role).sort()).toEqual(["member", "member", "member", "plan"]);
    expect(
      calls
        .map((x: Json) => x.member_key)
        .filter(Boolean)
        .sort(),
    ).toEqual(["m1", "m2", "m3"]);
    for (const x of calls) expect(x).toMatchObject({ model: "claude-sonnet", latency_ms: 1500 });
  });
  it("C5 · P4-02 · T (task) ⇒ detail=summary, totals bằng P4-01, team_runs=[], calls=[]", async () => {
    needSchema(c.ready);
    const full = await usage("A", f.run.runId);
    const r = await usage("T", f.run.runId);
    expect(r.status).toBe(200);
    expect(r.json?.detail).toBe("summary");
    expect(r.json?.totals).toEqual(full.json?.totals);
    for (const s of r.json?.stages ?? [])
      expect({ t: s.team_runs, c: s.calls }).toEqual({ t: [], c: [] });
  });
});

describe("P4-03, P4-04, P4-05 · ai xem + không cộng nhầm [HUB-BR-25, ADM-FR-67]", () => {
  it("HUB-BR-25 · P4-03 · H (không task ở run này) / D (+?tenant_id=acme) / cờ off ⇒ 404", async () => {
    needSchema(c.ready);
    await c.sql`delete from hub.review_task_assignees where user_id = ${PA.H.id}`;
    expect((await usage("H", f.run.runId)).status).toBe(404);
    expect((await usage("D", f.run.runId)).status).toBe(404);
    expect((await usage("D", f.run.runId, `?tenant_id=${T.acme}`)).status).toBe(404);
    const off = await startHubPa(c.k, { flag: false, instanceId: "qc-pa-pf4-off" });
    try {
      expect(
        (await api(off, await c.tok("A"), "GET", `/process-runs/${f.run.runId}/usage`)).status,
      ).toBe(404);
    } finally {
      await off.stop();
    }
  });
  it("AC-H34 · P4-04 · usage run thường của A + run quy trình khác ⇒ không cộng vào totals", async () => {
    needSchema(c.ready);
    const before = (await usage("A", f.run.runId)).json?.totals?.total;
    const other = await usageRun(c);
    await insertAttempt(c, { ...other.run }, PA.A, 0, [
      { role: "agent", member: null, in: 999, out: 1, cr: null, cw: null },
    ]);
    await c.sql`insert into hub.usage_logs (tenant_id, run_id, user_id, billing, input_tokens, output_tokens, job_id)
      select ${T.acme}, r.id, ${PA.A.id}, 'subscription', 5000, 500, gen_random_uuid() from hub.runs r
      where r.user_id = ${PA.A.id} and r.process_run_id is null limit 1`;
    const after = await usage("A", f.run.runId);
    expect(after.json?.totals?.total).toBe(before);
    expect(after.json?.totals?.total).toBe(f.total);
  });
  it("ADM-FR-67 · P4-05 · tadmin; platform_admin ?tenant_id=acme; X (thành viên R) ⇒ detail=full", async () => {
    needSchema(c.ready);
    for (const [r, qs] of [
      ["Adm", ""],
      ["P", `?tenant_id=${T.acme}`],
      ["X", ""],
    ] as const) {
      const res = await usage(r, f.run.runId, qs);
      expect({ r, status: res.status, detail: res.json?.detail }).toEqual({
        r,
        status: 200,
        detail: "full",
      });
    }
  });
});

describe("P4-06 · cắt danh sách lượt gọi [Q4]", () => {
  it("AC-H34 · P4-06 · 60 lần gọi stage 0 ⇒ calls.length=50, totals đủ 60", async () => {
    needSchema(c.ready);
    const g = await usageRun(c);
    const calls = Array.from({ length: 60 }, () => ({
      role: "agent" as const,
      member: null,
      in: 10,
      out: 1,
      cr: null,
      cw: null,
    }));
    await insertAttempt(c, g.run, PA.A, 0, calls);
    const r = await usage("A", g.run.runId);
    const s0 = r.json?.stages?.[0];
    expect(s0?.calls?.length).toBe(50);
    expect(s0?.totals?.calls).toBe(62);
    expect(r.json?.totals?.total).toBe((await usageSum(c, g.run.runId)).total);
  });
});
