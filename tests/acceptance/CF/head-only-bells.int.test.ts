// contract-flow S1b · trên hub THẬT (khuôn S1a `pack-runs-v2`): stage review `head_only` — thành viên Group duyệt không
// quyết được, trưởng phòng (`admin.departments.head_user_id`) quyết được; `PackRunsPort.openTasksOf` trả đúng task theo
// người; chuông gói (`hub.notifications`, nguồn `contracts`, link `/contracts/<record_id>`) được ghi cùng tx notice, chỉ cho
// trưởng phòng. Chéo tenant: tenant beta không thấy task của acme qua `openTasksOf`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type {
  PackRunCaller,
  PackRunsBridge,
  PackRunsPort,
} from "../../../apps/hub-api/src/modules/packs/kit/application/pack-runs.ports";
import {
  type CtxPd,
  DEFS,
  defBody,
  type Json,
  jobDone,
  MD_OK,
  nextStageJob,
  PA,
  PA_FIX,
  startPd,
  T,
  waitStatus,
} from "../P-d/_support/pd";

const KEY = "cf-s1b-head-only";
const REC = "cf5b0000-0000-4000-8000-000000000001";
const who = (p: { id: string; role: string }, tenantId: string): PackRunCaller => ({
  userId: p.id,
  tenantId,
  role: p.role,
});
const A = who(PA.A, T.acme); // người bắt đầu
const MEMBER = who(PA.B, T.acme); // hoa — thành viên Kế toán, không phải trưởng phòng
const HEAD = who(PA.T, T.acme); // cuc — trưởng phòng Kế toán
const ADM = who(PA.Adm, T.acme);
const DB = who(PA.Db, T.beta);

const stages = (): Json[] => {
  const s0 = DEFS.hd.stages[0] as Json;
  return [{ ...s0, after: { ...s0.after, head_only: true } }];
};

const bridge: PackRunsBridge = {};
let c: CtxPd;
let port: PackRunsPort;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 50, extraDeps: { packRuns: bridge } });
  if (!bridge.port) throw new Error("engine chưa gắn PackRunsPort (packRuns bridge)");
  if (typeof bridge.port.openTasksOf !== "function") throw new Error("chưa có openTasksOf (S1b)");
  port = bridge.port;
  await c.sql`insert into admin.departments (tenant_id, group_id, head_user_id)
    values (${T.acme}, ${PA_FIX.gKeToan}, ${PA.T.id})
    on conflict (group_id) do update set head_user_id = excluded.head_user_id`;
}, 90_000);
afterAll(async () => {
  if (!c) return;
  await c.sql`delete from admin.departments where group_id = ${PA_FIX.gKeToan}`.catch(() => {});
  await c.stop();
});

describe("contract-flow S1b · head_only + openTasksOf + chuông gói", () => {
  it("thành viên không quyết, trưởng phòng quyết; openTasksOf theo người; chuông contracts cho trưởng phòng", async () => {
    expect(await port.ensureDef(ADM, KEY, defBody(KEY, stages()), 1)).toBe("created");
    const s = await port.start(A, {
      process_key: KEY,
      input: "HĐ-02",
      ref: { pack: "contracts", record_id: REC },
    });
    await s.kick();
    await jobDone(c, await nextStageJob(c, s.runId), `${MD_OK}\n\n## Bàn giao\nĐã đọc HĐ-02.`);
    await waitStatus(c.sql, s.runId, "waiting_review");

    // canAct (thẻ duyệt): trưởng phòng có nút, thành viên không.
    expect((await port.stepsView(MEMBER, s.runId))?.steps[0]?.task?.can_act).toBe(false);
    expect((await port.stepsView(HEAD, s.runId))?.steps[0]?.task?.can_act).toBe(true);

    // Việc của tôi.
    expect(
      (await port.openTasksOf(MEMBER, "contracts")).filter((t) => t.run_id === s.runId),
    ).toEqual([]);
    const mine = (await port.openTasksOf(HEAD, "contracts")).filter((t) => t.run_id === s.runId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ record_id: REC, stage_key: "doc", escalated: false });

    // Chuông gói ghi cùng tx notice mở task: chỉ trưởng phòng (người nhận phía Group bị cửa trưởng phòng).
    const bells = await c.sql<Json[]>`select user_id, kind, link from hub.notifications
      where tenant_id = ${T.acme} and source = 'contracts' and link = ${`/contracts/${REC}`}
        and kind = 'approval.review_requested'`;
    expect(bells.map((b) => b.user_id)).toEqual([PA.T.id]);

    // Chéo tenant: beta không thấy task acme.
    expect((await port.openTasksOf(DB, "contracts")).filter((t) => t.run_id === s.runId)).toEqual(
      [],
    );

    // Quyết: thành viên bị chặn (404 như người ngoài), trưởng phòng Đạt.
    const denied = await port.act(MEMBER, s.runId, { stage: "doc" }, { result: "pass" }).then(
      () => "ok",
      (e: { code?: string; status?: number }) => e.code ?? String(e.status ?? "err"),
    );
    expect(denied).not.toBe("ok");
    expect(await port.act(HEAD, s.runId, { stage: "doc" }, { result: "pass" })).toBe("ok");
    expect((await port.openTasksOf(HEAD, "contracts")).filter((t) => t.run_id === s.runId)).toEqual(
      [],
    );
    expect(await port.lastApprover(T.acme, s.runId)).toBe(PA.T.id);
  }, 60_000);
});
