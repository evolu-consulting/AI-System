// esign-flow-fix #1 · trên hub THẬT: `approver_user_id` phải là user còn dùng được CÙNG tenant của def — def trỏ user tenant khác ⇒
// PROCESS_REF_INVALID (không lưu); người duyệt cụ thể bị khoá sau khi run mở ⇒ không còn là cửa duy nhất (rơi về cả Group duyệt),
// không nhận chuông; mở khoá lại ⇒ người đó lại là cửa.
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

const KEY = "esign-flow-approver-guard";
const REC = "e5f20000-0000-4000-8000-000000000001";
const who = (p: { id: string; role: string }, tenantId: string): PackRunCaller => ({
  userId: p.id,
  tenantId,
  role: p.role,
});
const A = who(PA.A, T.acme);
const MEMBER = who(PA.B, T.acme);
const APPROVER = who(PA.T, T.acme);
const ADM = who(PA.Adm, T.acme);

const stages = (approver: string): Json[] => {
  const s0 = DEFS.hd.stages[0] as Json;
  return [{ ...s0, after: { ...s0.after, approver_user_id: approver } }];
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
  if (!c) return;
  await c.sql`update admin.users set locked_by_tenant = false where id = ${PA.T.id}`.catch(
    () => {},
  );
  await c.stop();
});

describe("esign-flow-fix · approver_user_id cùng tenant + còn dùng được", () => {
  it("def trỏ user tenant khác ⇒ PROCESS_REF_INVALID", async () => {
    const code = await port
      .ensureDef(ADM, `${KEY}-x`, defBody(`${KEY}-x`, stages(PA.Db.id)), 1)
      .then(
        () => "ok",
        (e: { code?: string }) => e.code ?? "err",
      );
    expect(code).toBe("PROCESS_REF_INVALID");
  });

  it("người duyệt cụ thể bị khoá ⇒ cả Group duyệt quyết + không là cửa; mở khoá ⇒ lại là cửa", async () => {
    expect(await port.ensureDef(ADM, KEY, defBody(KEY, stages(PA.T.id)), 1)).toBe("created");
    const s = await port.start(A, {
      process_key: KEY,
      input: "HĐ-10",
      ref: { pack: "contracts", record_id: REC },
    });
    await s.kick();
    await jobDone(c, await nextStageJob(c, s.runId), `${MD_OK}\n\n## Bàn giao\nĐã đọc HĐ-10.`);
    await waitStatus(c.sql, s.runId, "waiting_review");
    expect((await port.stepsView(MEMBER, s.runId))?.steps[0]?.task?.can_act).toBe(false);

    await c.sql`update admin.users set locked_by_tenant = true where id = ${PA.T.id}`;
    expect((await port.stepsView(MEMBER, s.runId))?.steps[0]?.task?.can_act).toBe(true);
    const runOf = (t: { run_id: string }) => t.run_id === s.runId;
    expect((await port.openTasksOf(MEMBER, "contracts")).filter(runOf)).toHaveLength(1);

    await c.sql`update admin.users set locked_by_tenant = false where id = ${PA.T.id}`;
    expect((await port.stepsView(MEMBER, s.runId))?.steps[0]?.task?.can_act).toBe(false);
    expect((await port.stepsView(APPROVER, s.runId))?.steps[0]?.task?.can_act).toBe(true);
  }, 60_000);
});
