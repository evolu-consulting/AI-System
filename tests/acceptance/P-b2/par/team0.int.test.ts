// HUB-FR-114 · TECH-DEBT #135 · PB2-R18 · test-plan-cases §3.3 `par/team0` (PT-01, PT-02): stage NHÓM ở bước 0 (đơn và song
// song với stage agent) chạy được tới hết — `persistDraft` khi chưa có job không ném (plan D12). DB tag `pb2_par`.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import {
  type CtxPb2,
  DEFS2,
  type Job,
  type Json,
  jobDone,
  MD_HO,
  needPb2,
  P1,
  settleRuns,
  stageRow,
  startInRoom,
  startPb2,
  waitFor,
  waitStatus,
} from "../_support/pb2";

let c: CtxPb2;
beforeAll(async () => {
  c = await startPb2();
}, 60_000);
afterEach(async () => {
  if (c?.pb2) await settleRuns(c.sql);
});
afterAll(() => c?.stop());

const SEC: Record<string, string> = { [P1.agM1]: "Phần A", [P1.agM2]: "Phần B" };
const mdFor = (j: Job): string => {
  const sec = SEC[j.payload.agent.id];
  return sec ? `## ${sec}\nNội dung ${sec} của thành viên.` : MD_HO;
};

/** Phục vụ mọi job của run (theo agent) tới khi run rời `running`/`queued` hoặc hết `ms`; trả stage_idx các job đã nhận. */
async function serveAll(runId: string, ms = 20_000): Promise<number[]> {
  const end = Date.now() + ms;
  const seen: number[] = [];
  while (Date.now() < end) {
    const st = (await c.sql<Json[]>`select status from hub.process_runs where id = ${runId}`)[0]
      ?.status;
    if (st !== "running") break;
    const q = await waitFor(
      async () =>
        (
          await c.sql<
            Json[]
          >`select j.run_id, sr.stage_idx from hub.jobs j join hub.runs r on r.id = j.run_id
            join hub.stage_runs sr on sr.id = r.stage_run_id
            where r.process_run_id = ${runId} and j.status = 'queued' order by j.created_at limit 1`
        )[0],
      (v) => v !== undefined,
      300,
    );
    if (!q) continue;
    const j = await c.rt.tryNext(q.run_id, 300);
    if (!j) continue;
    seen.push(q.stage_idx);
    await jobDone(c, j, mdFor(j));
  }
  return seen;
}

describe("PT · nhóm ở bước 0 [#135][HUB-FR-114]", () => {
  it("HUB-FR-114 · PT-01 · pb2-team0: stage team bước 0 chạy được (không 500) và run tới done", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: DEFS2.team0.key });
    const seen = await serveAll(s.runId);
    await waitStatus(c.sql, s.runId, "done");
    expect(seen.includes(0)).toBe(true);
    expect(seen.at(-1)).toBe(1);
    expect((await stageRow(c.sql, s.runId, 0)).status).toBe("done");
  }, 40_000);
  it("HUB-FR-106 · PT-02 · pb2-team0p: team + agent cùng bước 0 cùng queued; join ⇒ Kết chạy; run done", async () => {
    needPb2(c.pb2);
    const s = await startInRoom(c, { key: DEFS2.team0p.key });
    const both = await waitFor(
      async () =>
        (
          await c.sql<
            Json[]
          >`select distinct sr.stage_idx from hub.jobs j join hub.runs r on r.id = j.run_id
            join hub.stage_runs sr on sr.id = r.stage_run_id where r.process_run_id = ${s.runId}`
        ).map((r) => r.stage_idx as number),
      (v) => v.includes(0) && v.includes(1),
      8_000,
    );
    expect([...(both ?? [])].sort()).toEqual([0, 1]);
    const seen = await serveAll(s.runId);
    await waitStatus(c.sql, s.runId, "done");
    expect(seen.at(-1)).toBe(2);
  }, 40_000);
});
