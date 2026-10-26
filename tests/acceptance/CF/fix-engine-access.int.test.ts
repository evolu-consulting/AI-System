// contract-flow fix-review #2 · #3 trên hub THẬT (khuôn S1a `pack-runs-v2`):
// #2 run gắn gói không huỷ được qua `POST /process-runs/:id/cancel` (người bắt đầu lẫn tenant_admin ⇒ 403) — chỉ gói huỷ;
//    huỷ bù của gói (`PackRunsPort.cancel`, người bắt đầu) vẫn huỷ được run của mình.
// #3 `passedStages` chỉ tính review `pass`: stage xong nhờ decision `use_current` (sau review Chưa đạt) KHÔNG là Đạt.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type {
  PackRunCaller,
  PackRunsBridge,
  PackRunsPort,
} from "../../../apps/hub-api/src/modules/packs/kit/application/pack-runs.ports";
import { insertOutput, insertRun, insertTask } from "../P-a/_support/process-fixtures";
import {
  type CtxPd,
  DEFS,
  defBody,
  type Json,
  jobDone,
  MD_OK,
  nextStageJob,
  PA,
  startPd,
  T,
  waitStatus,
} from "../P-d/_support/pd";

const KEY = "cf-fix-access";
const REC = "cf5f0000-0000-4000-8000-000000000001";
const who = (p: { id: string; role: string }): PackRunCaller => ({
  userId: p.id,
  tenantId: T.acme,
  role: p.role,
});
const A = who(PA.A);
const ADM = who(PA.Adm);

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

describe("fix-review · run gắn gói", () => {
  it("#2 không huỷ qua API process-runs (người bắt đầu, admin ⇒ 403); huỷ bù của gói vẫn được", async () => {
    expect(await port.ensureDef(ADM, KEY, defBody(KEY, [DEFS.hd.stages[0] as Json]), 1)).toBe(
      "created",
    );
    const s = await port.start(A, {
      process_key: KEY,
      input: "HĐ-F1",
      ref: { pack: "contracts", record_id: REC },
    });
    await s.kick();
    await jobDone(c, await nextStageJob(c, s.runId), `${MD_OK}\n\n## Bàn giao\nĐã đọc HĐ-F1.`);
    await waitStatus(c.sql, s.runId, "waiting_review");

    const byStarter = await c.call("A", "POST", `/process-runs/${s.runId}/cancel`, {});
    expect(byStarter.status).toBe(403);
    const byAdmin = await c.call("Adm", "POST", `/process-runs/${s.runId}/cancel`, {});
    expect(byAdmin.status).toBe(403);
    const [mid] = await c.sql<Json[]>`select status from hub.process_runs where id = ${s.runId}`;
    expect(mid?.status).toBe("waiting_review");

    await port.cancel(A, s.runId);
    const [end] = await c.sql<Json[]>`select status from hub.process_runs where id = ${s.runId}`;
    expect(end?.status).toBe("cancelled");
  }, 60_000);

  it("#3 passedStages: use_current sau review Chưa đạt không là Đạt; review pass mới là Đạt", async () => {
    const r = await insertRun(c.sql, {
      def: DEFS.hd as never,
      startedBy: { id: PA.A.id, tid: T.acme },
      status: "running",
      stageIdx: 1,
    });
    const stageRunId = r.stageRunIds[0] as string;
    const outputId = await insertOutput(c.sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId,
      stageIdx: 0,
    });
    const close = async (id: string, result: string, minsAgo: number) =>
      c.sql`update hub.review_tasks set status = 'closed', result = ${result},
        decided_at = now() - ${`${minsAgo} minutes`}::interval where id = ${id}`;
    const rv = await insertTask(c.sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId,
      kind: "review",
      outputId,
    });
    await close(rv, "fail", 10);
    const dc = await insertTask(c.sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId,
      kind: "decision",
    });
    await close(dc, "use_current", 5);
    expect(await port.passedStages(T.acme, r.runId)).toEqual([]);

    const rv2 = await insertTask(c.sql, {
      tid: T.acme,
      runId: r.runId,
      stageRunId,
      kind: "review",
      outputId,
    });
    await close(rv2, "pass", 1);
    expect(await port.passedStages(T.acme, r.runId)).toEqual(["doc"]);
  }, 30_000);
});
