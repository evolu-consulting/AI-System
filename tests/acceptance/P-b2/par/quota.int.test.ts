// HUB-FR-106 · HUB-BR-24 · PB2-R15 · test-plan-cases §3.3 PI-13 (mặc định readiness #13: `runsPerTenant=1`): quota đếm RUN
// quy trình, không đếm stage song song; job bước song song chạy bằng quyền người bắt đầu A. Ctx riêng (quota 1) ⇒ file riêng.
// DB tag `pb2_par`. 0024 vắng ⇒ đỏ ở `needPb2`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { startApi } from "../../P-a/pf1/_local";
import {
  type CtxPb2,
  DEFS2,
  finishStages,
  hubRunsOf,
  needPb2,
  PA,
  startInRoom,
  startPb2,
  waitQueued,
} from "../_support/pb2";

let c: CtxPb2;
beforeAll(async () => {
  c = await startPb2({ processRunsPerTenant: 1 });
}, 60_000);
afterAll(() => c?.stop());

describe("PI-13 · quota theo run [PB2-R15]", () => {
  it("HUB-FR-106 · PI-13 · runsPerTenant=1, run pb2-auto3 ở bước 1 (3 job) ⇒ run 2 bị 429 TOO_MANY_PROCESS_RUNS; 3 job đều user_id = A", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: DEFS2.auto3.key });
    await finishStages(c, s.runId, [0]);
    expect(await waitQueued(c.sql, s.runId, 3)).toEqual([1, 2, 3]);
    const r2 = await startApi(c, { key: DEFS2.auto3.key, input: "Run thứ hai" });
    expect({ status: r2.status, code: r2.json?.error?.code }).toEqual({
      status: 429,
      code: "TOO_MANY_PROCESS_RUNS",
    });
    const users = [];
    for (const i of [1, 2, 3])
      users.push(...(await hubRunsOf(c.sql, s.runId, i)).map((r) => r.user_id));
    expect(users).toEqual([PA.A.id, PA.A.id, PA.A.id]);
  }, 40_000);
});
