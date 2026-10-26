// contract-flow fix-review (gói contracts, hub THẬT, cờ engine bật): (1) Đọc lại do người khác bấm KHÔNG đổi người bắt đầu run ⇒ người
// gửi vẫn bị chặn ở bước exclude_starter; (2) run bị huỷ ngoài luồng ⇒ vòng quét GIỮ mode engine (không về máy cũ), thẻ needs_reopen,
// máy cũ không lách được, chỉ owner/admin "Mở lại quy trình" ⇒ run mới dưới người gửi. (3)(4)(5)(6) có unit (patch-guard, card usecase,
// sweep repo/rules); int này không lặp lại.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { act, approval, CBASE, errCode, seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, PA, T, waitFor } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const BIG = 600_000_000; // ≥ ngưỡng ⇒ bước 2 (owner, exclude_starter)
const row = async (aid: string): Promise<Json> =>
  (
    await c.sql<Json[]>`select status, mode, engine_run_id::text as run, feedback
      from contracts.approvals where id = ${aid}`
  )[0] as Json;
const startedBy = async (run: string): Promise<string> =>
  (
    (
      await c.sql<Json[]>`select started_by::text as s from hub.process_runs where id = ${run}`
    )[0] as Json
  ).s;

async function stepIs(id: string, idx: number, want: string): Promise<Json> {
  const r = await waitFor(
    async () => (await approval(c, "A", id)).json as Json,
    (j) => j?.steps?.[idx]?.status === want,
    10_000,
  );
  expect(r?.steps?.[idx]?.status).toBe(want);
  return r;
}

describe("fix-review · started_by + mở lại quy trình", () => {
  it("(1) B Đọc lại ⇒ run mới vẫn do A bắt đầu; ở bước 2 A bị chặn, H quyết được", async () => {
    const id = await seedContract(c, 721);
    const aid = (await toLevel1(c, id, BIG)).runId;
    await stepIs(id, 0, "open");
    const done = c.extracted(id);
    expect((await act(c, "B", id, "redo", "Đọc lại cho chắc")).status).toBe(200);
    expect(await done).toBe("needs_review");
    await stepIs(id, 0, "open");
    const a = await row(aid);
    expect(a.mode).toBe("engine");
    expect(await startedBy(a.run as string)).toBe(PA.A.id);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await stepIs(id, 1, "open");
    const asA = (await approval(c, "A", id)).json as Json;
    expect({ can: asA.can_act, why: asA.block_reason }).toEqual({ can: false, why: "starter" });
    expect(errCode(await act(c, "A", id, "approve"))).toBe("STARTER_CANNOT_REVIEW");
    expect(((await approval(c, "H", id)).json as Json).can_act).toBe(true);
  }, 90_000);

  it("(2) run bị huỷ ⇒ sweep giữ engine + needs_reopen; máy cũ không lách; chỉ admin mở lại ⇒ run mới dưới A", async () => {
    const id = await seedContract(c, 722);
    const aid = (await toLevel1(c, id, BIG)).runId;
    const run = (await row(aid)).run as string;
    await stepIs(id, 0, "open");
    expect(await c.port.cancelSys(T.acme, run)).toBe(true);
    await c.sweepOnce();
    expect(await row(aid)).toMatchObject({
      mode: "engine",
      status: "level1",
      feedback: "ENGINE_RUN_CANCELLED",
    });
    const card = (await approval(c, "B", id)).json as Json;
    expect({ nr: card.needs_reopen, can: card.can_act }).toEqual({ nr: true, can: false });
    // B (cấp 1) không duyệt được bằng máy cũ, cũng không mở lại được (không phải admin).
    expect(errCode(await act(c, "B", id, "approve"))).toBe("APPROVAL_NOT_OPEN");
    expect((await c.call("B", "POST", `${CBASE}/${id}/approval/reopen`, {})).status).toBe(403);
    const r = await c.call("A", "POST", `${CBASE}/${id}/approval/reopen`, {});
    expect(r.status).toBe(200);
    const a = await row(aid);
    expect(a.mode).toBe("engine");
    expect(a.run).not.toBe(run);
    expect(await startedBy(a.run as string)).toBe(PA.A.id);
    expect(a.feedback).toBeNull();
    await stepIs(id, 0, "open");
  }, 90_000);
});
