// contract-flow S1a · cầu gói ↔ engine v2 (`PackRunsPort`) trên hub THẬT (khuôn P-d `startPd`, launcher thật): ensureDef
// idempotent theo version → start + ref (pack_key/pack_record_id) → stepsView (open + can_act) → act pass (scope user) →
// outcomesOf / passedStages / lastApprover → cancelSys. Chéo tenant: tenant B không đọc/quyết/huỷ run của A.
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

const KEY = "cf-s1a-approval";
const REC = "cf5a0000-0000-4000-8000-000000000001";
const who = (p: { id: string; tid?: string; role: string }, tenantId: string): PackRunCaller => ({
  userId: p.id,
  tenantId,
  role: p.role,
});
const A = who(PA.A, T.acme);
const B = who(PA.B, T.acme);
const ADM = who(PA.Adm, T.acme);
const DB = who(PA.Db, T.beta);

const stages = (): Json[] => {
  const s0 = DEFS.hd.stages[0] as Json;
  const s1 = {
    ...s0,
    key: "duyet2",
    name: "Duyệt 2",
    output: { ...s0.output, filename: "duyet-2.md" },
  };
  return [s0, s1];
};

const bridge: PackRunsBridge = {};
let c: CtxPd;
let port: PackRunsPort;
beforeAll(async () => {
  c = await startPd({ processRunsPerTenant: 50, extraDeps: { packRuns: bridge } });
  if (!bridge.port) throw new Error("engine chưa gắn PackRunsPort (packRuns bridge)");
  port = bridge.port;
}, 90_000);
afterAll(async () => {
  await c?.stop();
});

describe("contract-flow S1a · PackRunsPort v2", () => {
  it("ensureDef → start ref → stepsView → act pass → outcomesOf/passedStages/lastApprover → cancelSys", async () => {
    const def = defBody(KEY, stages());
    expect(await port.ensureDef(ADM, KEY, def, 1)).toBe("created");
    expect(await port.ensureDef(ADM, KEY, def, 1)).toBe("exists");
    expect(await port.ensureDef(ADM, KEY, { ...def, name: "Duyệt v2" }, 2)).toBe("synced");
    const [d] = await c.sql<Json[]>`select name, pack_version from hub.process_defs
      where tenant_id = ${T.acme} and key = ${KEY} and deleted_at is null`;
    expect({ name: d?.name, v: d?.pack_version }).toEqual({ name: "Duyệt v2", v: 2 });

    const s = await port.start(A, {
      process_key: KEY,
      input: "HĐ-01",
      ref: { pack: "contracts", record_id: REC },
    });
    await s.kick();
    const [run] = await c.sql<Json[]>`select pack_key, pack_record_id from hub.process_runs
      where id = ${s.runId}`;
    expect(run).toEqual({ pack_key: "contracts", pack_record_id: REC });
    // Def lưu qua luật lưu ⇒ Hub thêm mục bắt buộc "Bàn giao" (withHandoff).
    await jobDone(c, await nextStageJob(c, s.runId), `${MD_OK}\n\n## Bàn giao\nĐã đọc HĐ-01.`);
    await waitStatus(c.sql, s.runId, "waiting_review");

    const vb = await port.stepsView(B, s.runId);
    expect(vb?.steps.map((x) => [x.key, x.status, x.group_id])).toEqual([
      ["doc", "open", PA_FIX.gKeToan],
      ["duyet2", "pending", PA_FIX.gKeToan],
    ]);
    expect(vb?.steps[0]?.task?.can_act).toBe(true);
    expect((await port.stepsView(A, s.runId))?.steps[0]?.task?.can_act).toBe(false);

    expect(await port.act(B, s.runId, { stage: "doc" }, { result: "pass" })).toBe("ok");
    expect(await port.act(B, s.runId, { stage: "doc" }, { result: "pass" })).toBe("not_open");
    const after = await port.stepsView(B, s.runId);
    expect(after?.steps[0]).toMatchObject({
      status: "passed",
      result: "pass",
      decided_by: { id: PA.B.id },
      task: null,
    });

    const [o] = await port.outcomesOf(T.acme, [s.runId]);
    expect(o).toMatchObject({ run_id: s.runId, tenant_id: T.acme, rejected: false });
    expect(await port.passedStages(T.acme, s.runId)).toEqual(["doc"]);
    expect(await port.lastApprover(T.acme, s.runId)).toBe(PA.B.id);
    const g = await port.groupIdsOf(T.acme, ["ke-toan", "khong-co"]);
    expect([...g]).toEqual([["ke-toan", PA_FIX.gKeToan]]);

    // Chéo tenant: tenant beta không thấy/quyết/huỷ run acme.
    expect(await port.stepsView(DB, s.runId)).toBeNull();
    expect(await port.act(DB, s.runId, { stage: "duyet2" }, { result: "pass" })).toBe("not_open");
    expect(await port.outcomesOf(T.beta, [s.runId])).toEqual([]);
    expect(await port.passedStages(T.beta, s.runId)).toEqual([]);
    expect(await port.lastApprover(T.beta, s.runId)).toBeNull();
    expect(await port.cancelSys(T.beta, s.runId)).toBe(false);

    expect(await port.cancelSys(T.acme, s.runId)).toBe(true);
    expect(await port.cancelSys(T.acme, s.runId)).toBe(false);
    const [end] = await c.sql<Json[]>`select status from hub.process_runs where id = ${s.runId}`;
    expect(end?.status).toBe("cancelled");
    const moved = await c.sql`update hub.process_runs set pack_record_id = ${REC.replace(/1$/, "2")}
      where id = ${s.runId}`.then(
      () => "ok",
      (e: Error) => e.message,
    );
    expect(moved).toContain("immutable");
  }, 60_000);
});
