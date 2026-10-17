// AC-H42 · HUB-FR-145 · HUB-FR-107 · HUB-BR-43/26 · PD-I46…PD-I49 (test-plan-int §4; plan-addendum A8 #57): forward sau chuyển cấp,
// luật lưu `escalate`, Group chuyển cấp bị xoá, task không cấu hình / ask / decision / snapshot def. Đỏ trước code ở
// `needPdSchema` (migration 0036). Helper chung `_remind.ts`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPd,
  decisionOf,
  G1,
  HOUR,
  type Json,
  jobAsk,
  jobDone,
  jobFail,
  MIN,
  needPdSchema,
  nextStageJob,
  openTask,
  PA,
  PD,
  PD_DEFS,
  type Role,
  remind,
  startPd,
  startRun,
  T,
  waitStatus,
} from "../_support/pd";
import {
  assigneesOf,
  auditsOf,
  ensureDef,
  escalateAll,
  MD_PD,
  noticeCounts,
  remindGate,
  taskRow,
} from "./_remind";

let c: CtxPd;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 200 });
}, 60_000);
afterAll(async () => {
  await c?.stop();
});

const forward = (r: Role, taskId: string, to: string) =>
  c.call(r, "POST", `/review-tasks/${taskId}/forward`, { to_user_id: to });
const err = (r: { status: number; json: Json }) => ({
  status: r.status,
  code: r.json?.error?.code ?? null,
});
const G3 = "a5d10000-0000-4000-8000-000000000348"; // Group chuyển cấp riêng PD-I48 (bị xoá giữa ca)
const UNKNOWN = "a5d10000-0000-4000-8000-0000000fffff";

describe("PD-I46 · forward sau chuyển cấp [AC-H42, HUB-FR-107]", () => {
  it("AC-H42 · PD-I46 · H → B (G1) ⇒ 403 FORWARD_OUT_OF_GROUP; B → T (G1) ⇒ 200; H → H2 (G2) ⇒ 200", async () => {
    needPdSchema(c.pd);
    await ensureDef(c, PD_DEFS.remind());
    const g = await remindGate(c);
    await escalateAll(c, [g]);
    expect(err(await forward("H", g.task.id, PA.B.id))).toEqual({
      status: 403,
      code: "FORWARD_OUT_OF_GROUP",
    });
    expect((await forward("B", g.task.id, PA.T.id)).status).toBe(200);
    expect((await forward("H", g.task.id, PA.H2.id)).status).toBe(200);
  }, 60_000);
});

describe("PD-I47 · luật lưu escalate [AC-H42, A8 #57]", () => {
  const body = (key: string, after: Json): Json => {
    const d = PD_DEFS.remind();
    d.key = key;
    d.stages[0].after = after;
    return d;
  };
  const review = (escalate: Json) => ({
    kind: "review",
    group_id: G1,
    back_to_steps: [],
    remind_every_h: 4,
    escalate,
  });
  const post = (b: Json) => c.call("Adm", "POST", "/process-defs", b);

  it("AC-H42 · PD-I47 · (a) escalate.group_id = Group duyệt ⇒ 422 PROCESS_DEF_INVALID rules ∋ ESCALATE_INVALID path stages.0.after.escalate", async () => {
    needPdSchema(c.pd);
    const r = await post(body("pd-i47-a", review({ after_h: 24, group_id: G1 })));
    expect(err(r)).toEqual({ status: 422, code: "PROCESS_DEF_INVALID" });
    const paths = (r.json?.error?.details?.paths ?? []) as string[];
    const rules = (r.json?.error?.details?.rules ?? []) as string[];
    const i = paths.indexOf("stages.0.after.escalate");
    expect({ i: i >= 0, rule: rules[i] }).toEqual({ i: true, rule: "ESCALATE_INVALID" });
  });
  it("AC-H42 · PD-I47 · (b) escalate ở stage after auto; (e) after_h 3 / 2161 ⇒ 400 VALIDATION_ERROR (zod, không ESCALATE_INVALID)", async () => {
    needPdSchema(c.pd);
    const cases: [string, Json][] = [
      ["pd-i47-b", { kind: "auto", escalate: { after_h: 24, group_id: PD.gG2 } }],
      ["pd-i47-e3", review({ after_h: 3, group_id: PD.gG2 })],
      ["pd-i47-e2161", review({ after_h: 2161, group_id: PD.gG2 })],
    ];
    for (const [key, after] of cases)
      expect({ key, ...err(await post(body(key, after))) }).toEqual({
        key,
        status: 400,
        code: "VALIDATION_ERROR",
      });
  });
  it("AC-H42 · PD-I47 · (c) Group của beta / (d) uuid không tồn tại ⇒ 422 PROCESS_REF_INVALID {path stages.0.after.escalate.group_id, ref group}, thông điệp như nhau", async () => {
    needPdSchema(c.pd);
    const rc = await post(body("pd-i47-c", review({ after_h: 24, group_id: PD.gBetaKT })));
    const rd = await post(body("pd-i47-d", review({ after_h: 24, group_id: UNKNOWN })));
    for (const r of [rc, rd]) {
      expect(err(r)).toEqual({ status: 422, code: "PROCESS_REF_INVALID" });
      expect(r.json?.error?.details).toEqual({
        path: "stages.0.after.escalate.group_id",
        ref: "group",
      });
    }
    expect(rc.json?.error?.message).toBe(rd.json?.error?.message);
  });
});

describe("PD-I48 · Group chuyển cấp bị xoá [AC-H42, HUB-FR-145]", () => {
  it("AC-H42 · PD-I48 · xoá Group đích trước T0+24 h ⇒ remind: không thêm assignee, escalated_at đặt, audit escalate_skipped, 0 notice escalated", async () => {
    needPdSchema(c.pd);
    await c.sql`insert into admin.groups (id, tenant_id, key, name)
      values (${G3}, ${T.acme}, 'pho-giam-doc', ${c.sql.json({ vi: "Phó giám đốc", en: "Deputies" })})`;
    await c.sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${T.acme}, ${G3}, ${PA.H3.id})`;
    const d = PD_DEFS.remind({ escalate: { after_h: 24, group_id: G3 } });
    d.key = "pd-remind-del";
    await ensureDef(c, d);
    const g = await remindGate(c, "pd-remind-del");
    await c.sql`delete from admin.group_members where group_id = ${G3}`;
    await c.sql`delete from admin.groups where id = ${G3}`;
    await escalateAll(c, [g]);
    expect((await assigneesOf(c, g.task.id)).filter((a) => a.via === "escalated")).toEqual([]);
    expect((await taskRow(c, g.task.id)).escalated_at).not.toBeNull();
    expect((await auditsOf(c, g.task.id, "escalate_skipped")).length).toBe(1);
    expect((await auditsOf(c, g.task.id, "escalate")).length).toBe(0);
    const [n] = await c.sql<Json[]>`select count(*)::int as n from hub.process_notices
      where task_id = ${g.task.id} and kind = 'escalated'`;
    expect(n?.n).toBe(0);
  }, 60_000);
});

describe("PD-I49 · không cấu hình / ask / decision / snapshot [AC-H42, HUB-BR-26]", () => {
  it("AC-H42 · PD-I49 · (a) def không cấu hình: remind tại T0+24 h ×2 ⇒ đúng 1 notice/assignee, remind_count 0, reminded_at đặt", async () => {
    needPdSchema(c.pd);
    const d = PD_DEFS.remind({ remind: null, escalate: null });
    d.key = "pd-remind-0";
    await ensureDef(c, d);
    const g = await remindGate(c, "pd-remind-0");
    const t0 = await taskRow(c, g.task.id);
    expect({ every: t0.remind_every_h, esc: t0.escalate_at }).toEqual({ every: null, esc: null });
    c.clk.set(new Date(g.t0b + 24 * HOUR + MIN));
    await remind(c);
    await remind(c);
    expect(await noticeCounts(c, g.task.id)).toEqual({ B: 1, T: 1, H: 0, H2: 0 });
    const t = await taskRow(c, g.task.id);
    expect({ remind_count: t.remind_count, reminded: t.reminded_at !== null }).toEqual({
      remind_count: 0,
      reminded: true,
    });
  }, 60_000);
  it("AC-H42 · PD-I49 · (b) task ask / decision của def có nhắc lặp ⇒ không chép remind_every_h / escalate_at", async () => {
    needPdSchema(c.pd);
    await ensureDef(c, PD_DEFS.remind());
    const ra = await startRun(c, "pd-remind");
    await jobAsk(c, await nextStageJob(c, ra), "Kỳ kế toán nào?");
    await waitStatus(c.sql, ra, "waiting_answer");
    const ask = await openTask(c.sql, ra, "ask");
    const rd = await startRun(c, "pd-remind");
    await jobFail(c, await nextStageJob(c, rd));
    await waitStatus(c.sql, rd, "needs_decision");
    const dec = await decisionOf(c.sql, rd);
    for (const [kind, t] of [
      ["ask", ask],
      ["decision", dec],
    ] as const)
      expect({
        kind,
        every: t?.remind_every_h,
        at: t?.escalate_at,
        g: t?.escalate_group_id,
      }).toEqual({ kind, every: null, at: null, g: null });
  }, 60_000);
  it("AC-H42 · PD-I49 · (c) sửa def remind_every_h 8 sau khi run bắt đầu ⇒ task giữ 4 (snapshot)", async () => {
    needPdSchema(c.pd);
    const d = PD_DEFS.remind();
    d.key = "pd-remind-c";
    await ensureDef(c, d);
    const runId = await startRun(c, "pd-remind-c");
    const [def] = await c.sql<Json[]>`select id, version from hub.process_defs
      where tenant_id = ${T.acme} and key = 'pd-remind-c' and deleted_at is null`;
    const upd = PD_DEFS.remind({ remind: 8 });
    upd.key = "pd-remind-c";
    const put = await c.call("Adm", "PUT", `/process-defs/${def?.id}`, {
      ...upd,
      version: def?.version,
    });
    expect(put.status).toBe(200);
    await jobDone(c, await nextStageJob(c, runId), MD_PD);
    await waitStatus(c.sql, runId, "waiting_review");
    expect((await openTask(c.sql, runId, "review"))?.remind_every_h).toBe(4);
  }, 60_000);
});
