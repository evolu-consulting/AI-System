// AC-H42 · HUB-FR-145 · HUB-BR-43/25/26 · PD-I40…PD-I45 (test-plan-int §4): task review `pd-remind` (G1 B/T, nhắc 4 h ×10,
// chuyển cấp sau 24 h sang G2 "Giám đốc" H/H2). Đồng hồ lệch `c.clk`, vòng nhắc = seam `remindOnce`. PD-I46…I49 ở
// `remind-escalate.int.test.ts`. Đỏ trước code ở `needPdSchema` (migration 0036) / `createDef` 201.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPd,
  G1,
  HOUR,
  type Json,
  MIN,
  needPdSchema,
  PA,
  PD,
  PD_DEFS,
  remind,
  review,
  runRow,
  SEC,
  startPd,
  sweepN,
  T,
  viewRun,
} from "../_support/pd";
import {
  assigneesOf,
  auditsOf,
  ensureDef,
  escalateAll,
  type Gate,
  ms,
  noticeCounts,
  remindGate,
  taskRow,
  within,
} from "./_remind";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 200 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

/** Def `pd-remind` (một lần mỗi file) + run tới gate G1. */
async function gate(): Promise<Gate> {
  needPdSchema(c.pd);
  await ensureDef(c, PD_DEFS.remind());
  return remindGate(c);
}

describe("PD-I40 · tạo task review chép cấu hình nhắc [AC-H42, HUB-FR-145]", () => {
  it("AC-H42 · PD-I40 · task review G1: remind_every_h 4, remind_at T0+4 h, remind_count 0, escalate_at T0+24 h, escalate_group_id G2, escalated_at NULL", async () => {
    const g = await gate();
    const t = await taskRow(c, g.task.id);
    expect({
      remind_every_h: t.remind_every_h,
      remind_count: t.remind_count,
      escalate_group_id: t.escalate_group_id,
      escalated_at: t.escalated_at,
      assignee_group_id: t.assignee_group_id,
    }).toEqual({
      remind_every_h: 4,
      remind_count: 0,
      escalate_group_id: PD.gG2,
      escalated_at: null,
      assignee_group_id: G1,
    });
    const r = ms(t.remind_at);
    const e = ms(t.escalate_at);
    expect(within("remind_at", r, g.t0a + 4 * HOUR - SEC, g.t0b + 4 * HOUR + SEC).ok).toBe(true);
    expect(within("escalate_at", e, g.t0a + 24 * HOUR - SEC, g.t0b + 24 * HOUR + SEC).ok).toBe(
      true,
    );
  });
});

describe("PD-I41 · nhắc lặp 4 h tối đa 10 lần [AC-H42, HUB-BR-43]", () => {
  it("AC-H42 · PD-I41 · T0+3h59 ⇒ 0 notice; mỗi mốc 4 h đúng 1 reminder/assignee (B, T; sau T0+24 h thêm H); remind_count 1…10; T0+44 h ⇒ không nhắc; task open, run waiting_review", async () => {
    const g = await gate();
    const id = g.task.id as string;
    const first = ms((await taskRow(c, id)).remind_at);
    c.clk.set(new Date(first - MIN));
    await remind(c);
    expect(await noticeCounts(c, id)).toEqual({ B: 0, T: 0, H: 0, H2: 0 });
    let prev = first;
    for (let k = 1; k <= 10; k++) {
      const row = await taskRow(c, id);
      const due = ms(row.remind_at);
      if (k > 1)
        expect(within(`remind_at#${k}`, due - prev, 4 * HOUR, 4 * HOUR + 2 * MIN).ok).toBe(true);
      prev = due;
      const before = await noticeCounts(c, id);
      c.clk.set(new Date(due + SEC));
      await remind(c);
      const after = await noticeCounts(c, id);
      expect({ k, B: after.B - before.B, T: after.T - before.T }).toEqual({ k, B: 1, T: 1 });
      if (k >= 7) expect({ k, H: after.H - before.H }).toEqual({ k, H: 1 });
      expect({ k, remind_count: (await taskRow(c, id)).remind_count }).toEqual({
        k,
        remind_count: k,
      });
    }
    const before = await noticeCounts(c, id);
    c.clk.set(new Date(prev + 4 * HOUR + MIN));
    await remind(c);
    expect(await noticeCounts(c, id)).toEqual(before);
    const t = await taskRow(c, id);
    expect({ status: t.status, remind_count: t.remind_count }).toEqual({
      status: "open",
      remind_count: 10,
    });
    expect((await runRow(c.sql, g.runId)).status).toBe("waiting_review");
  }, 60_000);
});

describe("PD-I42 · chuyển cấp sau 24 h [AC-H42, HUB-FR-145]", () => {
  it("AC-H42 · PD-I42 · remind tại T0+24 h ⇒ assignee G2 via=escalated (tenant acme); escalated_at; notice escalated + DM Quy trình cho H; audit escalate hệ thống {from_group G1, to_group G2}; lần 2 không thêm", async () => {
    const g = await gate();
    const id = g.task.id as string;
    const escAt = ms((await taskRow(c, id)).escalate_at);
    await escalateAll(c, [g]);
    const now = c.clk.now().getTime();
    const esc = (await assigneesOf(c, id)).filter((a) => a.via === "escalated");
    expect(esc).toEqual([
      { tenant_id: T.acme, user_id: null, group_id: PD.gG2, via: "escalated", depth: 0 },
    ]);
    expect(within("escalated_at", ms((await taskRow(c, id)).escalated_at), escAt, now).ok).toBe(
      true,
    );
    const nH = await c.sql<Json[]>`select id, payload, tenant_id from hub.process_notices
      where task_id = ${id} and kind = 'escalated' and user_id = ${PA.H.id}`;
    expect(nH.length).toBe(1);
    expect(nH[0]?.payload).toMatchObject({
      process_name: "Quy trình pd-remind",
      stage_name: "Bước doc",
    });
    expect(nH[0]?.tenant_id).toBe(T.acme);
    const inbox = await c.call("H", "GET", "/me/process-inbox");
    expect(inbox.status).toBe(200);
    expect((inbox.json?.items ?? []).map((i: Json) => i.id)).toContain(nH[0]?.id);
    const au = await auditsOf(c, id, "escalate");
    expect(au.map((a) => ({ actor: a.actor_id, entity: a.entity, tenant: a.tenant_id }))).toEqual([
      { actor: null, entity: "review_task", tenant: T.acme },
    ]);
    const det = [au[0]?.summary, au[0]?.after].find((d) => d?.from_group !== undefined);
    expect(det).toEqual({ from_group: G1, to_group: PD.gG2 });
    // lần 2: không thêm assignee / audit / notice
    const n0 = await noticeCounts(c, id, "escalated");
    c.clk.advance(MIN);
    await remind(c);
    expect((await assigneesOf(c, id)).filter((a) => a.via === "escalated").length).toBe(1);
    expect((await auditsOf(c, id, "escalate")).length).toBe(1);
    expect(await noticeCounts(c, id, "escalated")).toEqual(n0);
  }, 60_000);
});

describe("PD-I43, PD-I44 · sau chuyển cấp [AC-H42, HUB-BR-26]", () => {
  it("AC-H42 · PD-I43 · sau chuyển cấp: B (G1) Đạt ⇒ 200 task closed; song song H (G2) Đạt run khác ⇒ 200", async () => {
    const g1 = await gate();
    const g2 = await remindGate(c);
    await escalateAll(c, [g1, g2]);
    const [rb, rh] = await Promise.all([
      review(c, "B", g1.task.id, { result: "pass" }),
      review(c, "H", g2.task.id, { result: "pass" }),
    ]);
    expect([rb.status, rh.status]).toEqual([200, 200]);
    expect((await taskRow(c, g1.task.id)).status).toBe("closed");
    expect((await taskRow(c, g2.task.id)).status).toBe("closed");
  }, 60_000);
  it("AC-H42 · PD-I44 · sau chuyển cấp không ai duyệt, T0+100 h remind + sweep ⇒ task vẫn open (không tự Đạt/Chưa đạt)", async () => {
    const g = await gate();
    await escalateAll(c, [g]);
    c.clk.set(new Date(g.t0b + 100 * HOUR));
    await remind(c);
    await sweepN(c, 1);
    const t = await taskRow(c, g.task.id);
    expect({ status: t.status, result: t.result }).toEqual({ status: "open", result: null });
    expect((await runRow(c.sql, g.runId)).status).toBe("waiting_review");
  }, 60_000);
});

describe("PD-I45 · H ngoài phòng xem phần task [AC-H42, HUB-BR-25]", () => {
  it("AC-H42 · PD-I45 · H GET /process-runs/:id ⇒ access task, không inputs/history; audit view; TaskDetail escalated true + remind_count", async () => {
    const g = await gate();
    await escalateAll(c, [g]);
    const v = await viewRun(c, "H", g.runId);
    expect(v.status).toBe(200);
    expect(v.json?.access).toBe("task");
    for (const k of ["inputs", "input", "history", "thread", "outputs"])
      expect(v.json?.[k]).toBeUndefined();
    const mine = (v.json?.my_tasks ?? []).find((x: Json) => x.id === g.task.id);
    const t = await taskRow(c, g.task.id);
    expect(mine).toMatchObject({ escalated: true, remind_count: t.remind_count });
    const views = await c.sql<Json[]>`select count(*)::int as n from hub.audit_log
      where action = 'view' and entity = 'review_task' and entity_id = ${g.task.id} and actor_id = ${PA.H.id}`;
    expect(views[0]?.n).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
