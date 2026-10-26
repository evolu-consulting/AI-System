// contract-flow S3b · thẻ duyệt + hành động trên engine (cờ bật, hub THẬT): GET approval `mode=engine` có `steps[]`; đi 2 bước (giá trị ≥
// ngưỡng ⇒ cấp 2, người gửi bị chặn), Trả lại về bước 0, Từ chối ⇒ HĐ rejected, duyệt cuối + gắn SP (pending_links), reconcile run
// huỷ/lỗi ⇒ giữ engine + lý do; GET /groups; "Việc của tôi" có `approvals`. Theo điều phối: CHƯA chạy trong lát (chạy một lần cuối đợt).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insItem } from "../HD1/_support/hd1";
import { act, approval, CBASE, contractRow, errCode, seedContract, toLevel1 } from "../HD3/_hd3";
import { type Json, PA, T, waitFor, waitStatus } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const BIG = 600_000_000; // ≥ ngưỡng mặc định 500 triệu ⇒ cần bước 2 (Group owner, người gửi bị chặn)
const engineRun = async (aid: string) =>
  (
    await c.sql<Json[]>`select engine_run_id::text as run, mode, status, feedback
      from contracts.approvals where id = ${aid}`
  )[0] as Json;

/** Chờ thẻ có bước `idx` ở trạng thái `want` (engine chạy stage tool bất đồng bộ giữa hai bước). */
async function stepIs(id: string, idx: number, want: string): Promise<Json> {
  const r = await waitFor(
    async () => (await approval(c, "A", id)).json as Json,
    (j) => j?.steps?.[idx]?.status === want,
    10_000,
  );
  expect(r?.steps?.[idx]?.status).toBe(want);
  return r;
}

describe("contract-flow S3b · thẻ duyệt trên engine", () => {
  let id = "";
  let aid = "";

  it("GET: mode engine, 2 bước, bước 0 mở; B (Group cấp 1) và H (Toàn quyền — prod-fix2) quyết được", async () => {
    id = await seedContract(c, 711);
    aid = (await toLevel1(c, id, BIG)).runId;
    const e = await engineRun(aid);
    await waitStatus(c.sql, e.run as string, "waiting_review");
    const b = await stepIs(id, 0, "open");
    expect(b).toMatchObject({ mode: "engine", step: "level1", finalizes_on_approve: false });
    expect(b.steps.map((s: Json) => [s.idx, s.status])).toEqual([
      [0, "open"],
      [1, "pending"],
    ]);
    const asB = (await approval(c, "B", id)).json as Json;
    expect({ can: asB.can_act, task: typeof asB.task_id }).toEqual({ can: true, task: "string" });
    const asH = (await approval(c, "H", id)).json as Json;
    // prod-fix2 · người dùng: "Toàn quyền xác nhận được bước 1" (như máy cũ) ⇒ H (Group owner, ngoài Group cấp 1) quyết được.
    expect({ can: asH.can_act, why: asH.block_reason }).toEqual({ can: true, why: null });
  }, 60_000);

  it("Đạt bước 0 ⇒ bước 1 mở; người gửi (A) bị chặn, H duyệt được", async () => {
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    const j = await stepIs(id, 1, "open");
    expect(j.steps[0].status).toBe("passed");
    expect(j.steps[0].decided_by?.id).toBe(PA.B.id);
    const asA = (await approval(c, "A", id)).json as Json;
    expect({ can: asA.can_act, why: asA.block_reason }).toEqual({ can: false, why: "starter" });
    const denied = await act(c, "A", id, "approve");
    expect(errCode(denied)).toBe("STARTER_CANNOT_REVIEW");
  }, 60_000);

  it("Trả lại (cần lý do) ⇒ về bước 0; Đạt lại ⇒ bước 1 mở lại", async () => {
    expect(errCode(await act(c, "H", id, "return"))).toBe("FEEDBACK_REQUIRED");
    expect((await act(c, "H", id, "return", "Sửa điều khoản thanh toán")).status).toBe(200);
    const j = await stepIs(id, 0, "open");
    expect(j.steps[1].status).not.toBe("open");
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await stepIs(id, 1, "open");
  }, 60_000);

  it("duyệt cuối (H) + products ⇒ HĐ active, khoá, SP gắn trong cùng tx; finalizes_on_approve báo trước", async () => {
    const item = "e3000000-0000-4000-8000-000000000711";
    await insItem(c.sql, T.acme, id, 90, { id: item, name: "Thùng CF-711" } as never);
    const pre = (await approval(c, "H", id)).json as Json;
    expect(pre.finalizes_on_approve).toBe(true);
    const products = [
      { item_id: item, new_product: { name: "Thùng CF-711", unit: "thùng", group: "goods" } },
    ];
    const r = await c.call("H", "POST", `${CBASE}/${id}/approval`, { action: "approve", products });
    expect(r.status).toBe(200);
    const e = await engineRun(aid);
    await waitStatus(c.sql, e.run as string, "done");
    expect((await contractRow(c, id)).status).toBe("active");
    const [it0] = await c.sql<
      Json[]
    >`select product_id is not null as linked from contracts.contract_items
      where id = ${item}`;
    expect(it0?.linked).toBe(true);
  }, 60_000);

  it("Từ chối cần lý do ⇒ HĐ rejected ngay (không chờ vòng quét)", async () => {
    const id2 = await seedContract(c, 712);
    const aid2 = (await toLevel1(c, id2, BIG)).runId;
    await stepIs(id2, 0, "open");
    expect(errCode(await act(c, "B", id2, "reject"))).toBe("FEEDBACK_REQUIRED");
    const r = await act(c, "B", id2, "reject", "Sai đối tác");
    expect(r.status).toBe(200);
    expect((await contractRow(c, id2)).status).toBe("rejected");
    expect((await engineRun(aid2)).status).toBe("rejected");
  }, 60_000);

  it("reconcile: run bị huỷ ngoài luồng ⇒ vòng quét GIỮ engine + ghi lý do (không về máy cũ)", async () => {
    const id3 = await seedContract(c, 713);
    const aid3 = (await toLevel1(c, id3, BIG)).runId;
    const run = (await engineRun(aid3)).run as string;
    await stepIs(id3, 0, "open");
    expect(await c.port.cancelSys(T.acme, run)).toBe(true);
    const s = (await c.sweepOnce()) as unknown as { stalled: number };
    expect(s.stalled).toBeGreaterThanOrEqual(1);
    const a = await engineRun(aid3);
    expect({ mode: a.mode, status: a.status, why: a.feedback }).toEqual({
      mode: "engine",
      status: "level1",
      why: "ENGINE_RUN_CANCELLED",
    });
    // máy cũ KHÔNG quyết được (không lách luồng): cần owner mở lại quy trình
    expect(errCode(await act(c, "B", id3, "approve"))).toBe("APPROVAL_NOT_OPEN");
  }, 60_000);

  it("GET /pack/contracts/groups trả {id, name} của tenant; Việc của tôi có approvals cho người quyết được", async () => {
    const g = await c.call("B", "GET", "/pack/contracts/groups");
    expect(g.status).toBe(200);
    expect(
      (g.json as Json[]).every((x) => typeof x.id === "string" && typeof x.name === "string"),
    ).toBe(true);
    const id4 = await seedContract(c, 714);
    await toLevel1(c, id4, BIG);
    await stepIs(id4, 0, "open");
    const w = (await c.call("B", "GET", "/pack/contracts/my-work")).json as Json;
    expect(w.approvals.some((x: Json) => x.contract_id === id4)).toBe(true);
  }, 60_000);
});
