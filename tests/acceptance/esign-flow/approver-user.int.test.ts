// esign-flow · trên hub THẬT (khuôn CF/head-only-bells): stage review có `approver_user_id` (người duyệt cụ thể, ngoài Group duyệt)
// — thành viên Group duyệt không quyết, đúng người cụ thể quyết; `openTasksOf` + chuông gói chỉ cho người đó; tenant khác không thấy.
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

const KEY = "esign-flow-approver";
const REC = "e5f10000-0000-4000-8000-000000000001";
const who = (p: { id: string; role: string }, tenantId: string): PackRunCaller => ({
  userId: p.id,
  tenantId,
  role: p.role,
});
const A = who(PA.A, T.acme); // người bắt đầu
const MEMBER = who(PA.B, T.acme); // thành viên Group duyệt
const APPROVER = who(PA.T, T.acme); // người duyệt cụ thể
const ADM = who(PA.Adm, T.acme);
const DB = who(PA.Db, T.beta);

const stages = (): Json[] => {
  const s0 = DEFS.hd.stages[0] as Json;
  return [{ ...s0, after: { ...s0.after, approver_user_id: PA.T.id } }];
};

const bridge: PackRunsBridge = {};
let c: CtxPd;
let port: PackRunsPort;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 50, extraDeps: { packRuns: bridge } });
  if (!bridge.port) throw new Error("engine chưa gắn PackRunsPort (packRuns bridge)");
  port = bridge.port;
  await c.sql`delete from admin.departments where group_id = ${PA_FIX.gKeToan}`;
}, 90_000);
afterAll(async () => {
  await c?.stop();
});

describe("esign-flow · approver_user_id trên engine", () => {
  it("chỉ người cụ thể quyết; Việc của tôi + chuông chỉ người đó; tenant khác không thấy", async () => {
    expect(await port.ensureDef(ADM, KEY, defBody(KEY, stages()), 1)).toBe("created");
    const s = await port.start(A, {
      process_key: KEY,
      input: "HĐ-9",
      ref: { pack: "contracts", record_id: REC },
    });
    await s.kick();
    await jobDone(c, await nextStageJob(c, s.runId), `${MD_OK}\n\n## Bàn giao\nĐã đọc HĐ-9.`);
    await waitStatus(c.sql, s.runId, "waiting_review");

    expect((await port.stepsView(MEMBER, s.runId))?.steps[0]?.task?.can_act).toBe(false);
    expect((await port.stepsView(APPROVER, s.runId))?.steps[0]?.task?.can_act).toBe(true);
    const runOf = (t: { run_id: string }) => t.run_id === s.runId;
    expect((await port.openTasksOf(MEMBER, "contracts")).filter(runOf)).toEqual([]);
    expect((await port.openTasksOf(APPROVER, "contracts")).filter(runOf)).toHaveLength(1);
    expect((await port.openTasksOf(DB, "contracts")).filter(runOf)).toEqual([]);

    const bells = await c.sql<Json[]>`select user_id from hub.notifications
      where tenant_id = ${T.acme} and source = 'contracts' and link = ${`/contracts/${REC}`}
        and kind = 'approval.review_requested'`;
    expect(bells.map((b) => b.user_id)).toEqual([PA.T.id]);

    const denied = await port.act(MEMBER, s.runId, { stage: "doc" }, { result: "pass" }).then(
      () => "ok",
      () => "denied",
    );
    expect(denied).toBe("denied");
    expect(await port.act(APPROVER, s.runId, { stage: "doc" }, { result: "pass" })).toBe("ok");
    expect(await port.lastApprover(T.acme, s.runId)).toBe(PA.T.id);
  }, 60_000);
});
