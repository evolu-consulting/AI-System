// HUB-BR-25 · AC-H29 · HUB-FR-113 · C2 · dòng thêm ma trận (test-plan-int §6, plan-contract §8): M-audit, M-A'-out, M-M4,
// M-body, M-404-same, M-thread-insert, M-thread-events, M-thread-agent, M-C2. Run SQL như isolation.int (R1 ở R, R1' ở R3 do A
// bắt đầu rồi rời phòng — U5); M-C2 chạy stage thật (launcher PF1) qua runtime giả.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { HUB_API_URL, sign } from "../../H1/_fixtures";
import { endSqlRun } from "../../H2a/_h2a2";
import { api, asUser, pgCode, Q } from "../../X2a/_x2a";
import {
  fixId,
  insertEvent,
  insertOutput,
  insertRun,
  insertTask,
  type Json,
  PA,
  PA_FIX,
  part,
  postRoom,
  type Res,
  type RunFix,
  type Sql,
  T,
} from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  type CtxPf1,
  DEFS,
  nextStageJob,
  noStageJob,
  P1,
  runRow,
  stageHubRuns,
  startInRoom,
  startPf1,
  waitStatus,
} from "./_local";

const TO = 30_000;
const SECRET = "ROOM-SECRET-P1";
const INPUT = "HD-12 tháng 9 INPUT-SECRET";
const ROOM3 = "a5a18000-0000-4000-8000-000000000013";
let c: CtxPf1;
let db: Sql;
type Fx = RunFix & { oCur: string; oOld: string; oS1: string; taskId: string };
let R1: Fx;
let R1L: Fx;

async function mkRun(sql: Sql, roomId: string, status = "waiting_review"): Promise<Fx> {
  const f = await insertRun(sql, {
    def: DEFS.hd as never,
    startedBy: PA.A,
    roomId,
    status,
    input: INPUT,
  });
  const s0 = { tid: T.acme, runId: f.runId, stageRunId: f.stageRunIds[0] as string, stageIdx: 0 };
  const s1 = { tid: T.acme, runId: f.runId, stageRunId: f.stageRunIds[1] as string, stageIdx: 1 };
  const oOld = await insertOutput(sql, { ...s0, version: 1 });
  const oCur = await insertOutput(sql, { ...s0, version: 2 });
  const oS1 = await insertOutput(sql, { ...s1, version: 1 }); // output stage khác
  const taskId = await insertTask(sql, {
    ...s0,
    kind: "review",
    outputId: oCur,
    groupId: PA_FIX.gKeToan,
    userIds: [PA.T.id],
    status: status === "waiting_review" ? "open" : "closed",
  });
  await insertTask(sql, { ...s0, kind: "ask", userIds: [PA.H.id], status: "closed" });
  return { ...f, oCur, oOld, oS1, taskId };
}

beforeAll(async () => {
  c = await startPf1();
  db = postgres(HUB_API_URL, { max: 2, onnotice: () => {} });
  if (!c.ready) return;
  await c.sql`insert into hub.rooms (id, tenant_id, kind, name, last_seq, last_activity_at, created_by, created_at)
    values (${ROOM3}, ${T.acme}, 'group', 'Phòng R3', 0, now(), ${PA.A.id}, now())`;
  await c.sql`insert into hub.room_members (room_id, tenant_id, user_id, role, joined_at, last_read_seq, left_at) values
    (${ROOM3}, ${T.acme}, ${PA.A.id}, 'owner', now() - interval '2 day', 0, now() - interval '1 hour'),
    (${ROOM3}, ${T.acme}, ${PA.B.id}, 'member', now() - interval '2 day', 0, null)`;
  R1 = await mkRun(c.sql, PA_FIX.room);
  R1L = await mkRun(c.sql, ROOM3);
  await postRoom(c, "A", PA_FIX.room, { content: `${SECRET} số liệu nội bộ` });
  await insertEvent(c.sql, { runId: R1.runId, roomId: PA_FIX.room, meta: part.block(R1.runId) });
}, 60_000);
afterAll(async () => {
  await db?.end();
  await c?.stop();
});

const views = async (actor: string) =>
  (
    await c.sql<{ n: number }[]>`select count(*)::int as n from hub.audit_log
      where action = 'view' and actor_id = ${actor}`
  )[0]?.n ?? 0;
const q06 = async (method: string, path: string): Promise<Res> =>
  api(c.hub, await sign(c.k, Q[5] as Json), method, path);

describe("Dòng thêm ma trận PF1 [HUB-BR-25, plan-contract §8]", () => {
  it(
    "HUB-BR-25 · M-audit · T GET run 2 lần ⇒ đúng 1 audit view (review_task); mỗi GET output ⇒ +1",
    async () => {
      needSchema(c.ready);
      const v0 = await views(PA.T.id);
      expect((await c.call("T", "GET", `/process-runs/${R1.runId}`)).status).toBe(200);
      expect((await c.call("T", "GET", `/process-runs/${R1.runId}`)).status).toBe(200);
      expect(await views(PA.T.id)).toBe(v0 + 1);
      const [a] = await c.sql<
        Json[]
      >`select entity from hub.audit_log where action = 'view' and actor_id = ${PA.T.id}
      order by seq desc limit 1`;
      expect(a?.entity).toBe("review_task");
      expect(
        (await c.call("T", "GET", `/process-runs/${R1.runId}/outputs/${R1.oCur}`)).status,
      ).toBe(200);
      expect(await views(PA.T.id)).toBe(v0 + 2);
      expect(
        (await c.call("T", "GET", `/process-runs/${R1.runId}/outputs/${R1.oCur}`)).status,
      ).toBe(200);
      expect(await views(PA.T.id)).toBe(v0 + 3);
    },
    TO,
  );

  it(
    "HUB-BR-25 · M-A'-out · A' GET output mọi phiên bản/stage ⇒ 200 + audit view mỗi lần, kể cả sau run done",
    async () => {
      needSchema(c.ready);
      const read = async () => {
        for (const oid of [R1L.oCur, R1L.oOld, R1L.oS1]) {
          const v0 = await views(PA.A.id);
          const r = await c.call("A", "GET", `/process-runs/${R1L.runId}/outputs/${oid}`);
          expect(r.status).toBe(200);
          expect(r.json?.id).toBe(oid);
          expect(await views(PA.A.id)).toBe(v0 + 1);
        }
      };
      await read();
      await c.sql`update hub.process_runs set status = 'done', finished_at = now() where id = ${R1L.runId}`;
      const v = await c.call("A", "GET", `/process-runs/${R1L.runId}`);
      expect(v.status).toBe(200);
      expect(v.json?.access).toBe("task");
      expect((v.json?.outputs as Json[])?.length).toBe(3);
      await read();
    },
    TO,
  );

  it(
    "HUB-BR-25 · M-M4 · run done: T GET run ⇒ task, stages=[], output task mình 200, output khác 404",
    async () => {
      needSchema(c.ready);
      const f = await mkRun(c.sql, PA_FIX.room, "done");
      const v = await c.call("T", "GET", `/process-runs/${f.runId}`);
      expect(v.status).toBe(200);
      expect(v.json?.access).toBe("task");
      expect(v.json?.stages).toEqual([]);
      expect((await c.call("T", "GET", `/process-runs/${f.runId}/outputs/${f.oCur}`)).status).toBe(
        200,
      );
      expect((await c.call("T", "GET", `/process-runs/${f.runId}/outputs/${f.oOld}`)).status).toBe(
        404,
      );
      expect((await c.call("T", "GET", `/process-runs/${f.runId}/outputs/${f.oS1}`)).status).toBe(
        404,
      );
    },
    TO,
  );

  it(
    "HUB-BR-25 · M-body · body T/H/A' không chứa input, history, tên phòng, nội dung tin R",
    async () => {
      needSchema(c.ready);
      const bodies = [
        await c.call("T", "GET", `/process-runs/${R1.runId}`),
        await c.call("H", "GET", `/process-runs/${R1.runId}`),
        await c.call("A", "GET", `/process-runs/${R1L.runId}`),
      ];
      for (const r of bodies) {
        expect(r.status).toBe(200);
        for (const bad of ["INPUT-SECRET", '"history"', '"input"', "Phòng R", SECRET])
          expect(r.text).not.toContain(bad);
      }
    },
    TO,
  );

  it(
    "HUB-BR-25 · M-404-same · 404 run không tồn tại ≡ 404 run không được thấy (status + body)",
    async () => {
      needSchema(c.ready);
      const ghost = await q06("GET", `/process-runs/${fixId()}`);
      const hidden = await q06("GET", `/process-runs/${R1.runId}`);
      expect(ghost.status).toBe(404);
      expect(hidden.status).toBe(404);
      expect(hidden.json).toEqual(ghost.json);
      const d = await c.call("D", "GET", `/process-runs/${R1.runId}`);
      expect(d.status).toBe(404);
      expect(d.json).toEqual(ghost.json);
    },
    TO,
  );

  it(
    "HUB-FR-113 · M-thread-insert · A, B, X scope user chèn tin `process` / gọi room_post_process_message ⇒ 42501",
    async () => {
      needSchema(c.ready);
      const [ev] = await c.sql<{ id: string }[]>`select id from hub.process_thread_events
      where process_run_id = ${R1.runId} limit 1`;
      for (const who of [PA.A, PA.B, PA.X]) {
        const ins = await pgCode(
          asUser(db, who, async (tx) => {
            const [q] = await tx`select hub.room_next_seq(${PA_FIX.room}) as s`;
            await tx`insert into hub.room_messages ${tx({
              id: fixId(),
              room_id: PA_FIX.room,
              tenant_id: T.acme,
              sender_type: "process",
              sender_id: PA_FIX.defHoaDon,
              content: "Giả mạo kết quả kiểm",
              flow_id: R1.flowId,
              placement: "flow",
              process_run_id: R1.runId,
              process_kind: "task_result",
              process_meta: tx.json(part.task_result(R1.runId, who)),
              seq: q?.s,
              created_at: new Date(),
            })}`;
          }),
        );
        expect(ins).toBe("42501");
        expect(
          await pgCode(
            asUser(
              db,
              who,
              (tx) => tx`select * from hub.room_post_process_message(${ev?.id ?? fixId()})`,
            ),
          ),
        ).toBe("42501");
      }
    },
    TO,
  );

  it(
    "HUB-FR-113 · M-thread-events · A, B, X scope user SELECT process_thread_events của R1 ⇒ 0 hàng",
    async () => {
      needSchema(c.ready);
      for (const who of [PA.A, PA.B, PA.X]) {
        const rows = await asUser(
          db,
          who,
          (tx) => tx`select id from hub.process_thread_events where process_run_id = ${R1.runId}`,
        );
        expect(rows).toHaveLength(0);
      }
    },
    TO,
  );

  it(
    "HUB-FR-113 · M-thread-agent · B gửi `@hd-read …` trong thread F ⇒ 422 PROCESS_THREAD_NO_AGENT, 0 hub.runs",
    async () => {
      needSchema(c.ready);
      const n0 = (await c.sql<{ n: number }[]>`select count(*)::int as n from hub.runs`)[0]?.n;
      const s = await postRoom(c, "B", PA_FIX.room, {
        content: "@hd-read đọc lại hoá đơn",
        flow_id: R1.flowId,
      });
      expect(s.res.status).toBe(422);
      expect(s.res.json?.error?.code).toBe("PROCESS_THREAD_NO_AGENT");
      expect(s.runId).toBeNull();
      expect((await c.sql<{ n: number }[]>`select count(*)::int as n from hub.runs`)[0]?.n).toBe(
        n0,
      );
    },
    TO,
  );

  it("HUB-BR-23 · M-C2 · stage nhóm không cần grant thành viên (job user=A); thu entitlement / tắt thành viên / agent đơn không grant ⇒ permission_lost; beta tham chiếu qc-team ⇒ 422", async () => {
    needSchema(c.ready);
    const settle = async () => {
      for (const r of await c.sql<
        { id: string }[]
      >`select id from hub.runs where status = 'running'`)
        await endSqlRun(c.sql, r.id);
    };
    const bump = () =>
      c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
    // (a) A không có grant m1–m3 ⇒ stage nhóm chạy, job user_id = A
    const a = await startInRoom(c, { key: "p-team" });
    const j = await nextStageJob(c, a.runId);
    expect(j.payload.user_id).toBe(PA.A.id);
    for (const r of await stageHubRuns(c.sql, a.runId)) expect(r.user_id).toBe(PA.A.id);
    await settle();
    const lost = async (key: string) => {
      const s = await startInRoom(c, { key });
      const r = await waitStatus(c.sql, s.runId, "needs_decision");
      expect(r?.decision?.reason).toBe("permission_lost");
      expect(r?.decision?.options).toHaveLength(3);
      expect(await noStageJob(c, s.runId)).toBe(true);
      expect(await runRow(c.sql, s.runId)).toBeDefined();
    };
    // (b) thu entitlement qc-team của acme
    await c.sql`update hub.agent_team_entitlements set revoked_at = now() where team_id = ${P1.teamQc} and tenant_id = ${T.acme}`;
    await bump();
    await lost("p-team");
    await c.sql`update hub.agent_team_entitlements set revoked_at = null where team_id = ${P1.teamQc}`;
    // (c) tắt agent m2
    await c.sql`update hub.agents set enabled = false where id = ${P1.agM2}`;
    await bump();
    await lost("p-team");
    await c.sql`update hub.agents set enabled = true where id = ${P1.agM2}`;
    // (d) stage agent đơn, A không có grant hd-read
    await c.sql`delete from hub.agent_grants where agent_id = ${P1.agRead} and subject_id = ${PA.A.id}`;
    await bump();
    await lost("p-single");
    await settle();
    // nhóm chưa bật cho beta ⇒ def beta tham chiếu qc-team ⇒ 422 PROCESS_REF_INVALID{ref:"team"}
    const r = await c.call("Db", "POST", "/process-defs", {
      key: "p-team-beta",
      name: DEFS.team.name,
      description: "",
      input_hint: "",
      run_group_ids: [],
      stages: DEFS.team.stages,
      token_budget: null,
      enabled: false,
    });
    expect(r.status).toBe(422);
    expect(r.json?.error?.code).toBe("PROCESS_REF_INVALID");
    expect(r.json?.error?.details?.ref).toBe("team");
  }, 90_000);

  it(
    "ADM-FR-67 · D4 · platform_admin GET /process-runs?scope=tenant&process_key&tenant_id=<tenant khác> ⇒ run của tenant đó; tadmin/member chỉ tenant mình",
    async () => {
      needSchema(c.ready);
      const q = (extra: string) =>
        `/process-runs?scope=tenant&process_key=hoa-don-t&limit=200${extra}`;
      const p = await c.call("P", "GET", q(`&tenant_id=${T.acme}`));
      expect(p.status).toBe(200);
      const items = (p.json?.items ?? []) as Json[];
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.some((i) => i.id === R1.runId)).toBe(true);
      // tadmin beta + ?tenant_id=acme ⇒ bỏ qua tham số, chỉ tenant beta (không có run hoa-don-t của acme)
      const b = await c.call("Db", "GET", q(`&tenant_id=${T.acme}`));
      expect(b.status).toBe(200);
      expect(((b.json?.items ?? []) as Json[]).some((i) => i.id === R1.runId)).toBe(false);
      // tadmin acme + ?tenant_id=beta ⇒ vẫn thấy tenant mình
      const a = await c.call("Adm", "GET", q(`&tenant_id=${T.beta}`));
      expect(a.status).toBe(200);
      expect(((a.json?.items ?? []) as Json[]).some((i) => i.id === R1.runId)).toBe(true);
      // member scope=tenant ⇒ 403
      const m = await c.call("X", "GET", q(`&tenant_id=${T.beta}`));
      expect(m.status).toBe(403);
      // member mine + ?tenant_id=beta ⇒ chỉ run của mình ở acme
      const mine = await c.call("A", "GET", `/process-runs?tenant_id=${T.beta}`);
      expect(mine.status).toBe(200);
      expect(((mine.json?.items ?? []) as Json[]).some((i) => i.id === R1.runId)).toBe(true);
    },
    TO,
  );
});
