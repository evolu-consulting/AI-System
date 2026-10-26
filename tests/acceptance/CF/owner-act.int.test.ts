// contract-flow prod-fix2 (lỗi e2e server 2026-10-27) · hub THẬT, cờ engine bật: người "Toàn quyền" (Group owner = Group cấp 2,
// KHÔNG thuộc Group cấp 1) quyết được bước 1 trên engine như máy cũ (`also_group_ids` của stage review); người gửi vẫn bị chặn ở
// bước `exclude_starter`; người ngoài cả hai nhóm (chỉ xem) không quyết được.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  act,
  agentJson,
  approval,
  bump,
  CBASE,
  contractRow,
  errCode,
  groupId,
  seedContract,
  total,
  untilActions,
} from "../HD3/_hd3";
import { type Json, PA, type Role, T, waitFor, waitStatus } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
beforeAll(async () => {
  c = await startCf();
  // X chỉ xem (Group viewer của gói) — ngoài cả Group cấp 1 lẫn Toàn quyền.
  const viewer = await groupId(c, "viewer");
  await c.sql`insert into admin.group_members (tenant_id, group_id, user_id)
    values (${T.acme}, ${viewer}, ${PA.X.id}) on conflict do nothing`;
  await bump(c);
  await untilActions(c, "X", ["read"]);
}, 180_000);
afterAll(async () => {
  await c?.stop();
});

const BIG = 600_000_000;

/** `who` (chủ HĐ) bấm Đọc ⇒ lượt cấp 1 trên engine, run chờ duyệt. Trả id HĐ + run. */
async function openBy(who: Role, n: number, v: number): Promise<{ id: string; run: string }> {
  const id = await seedContract(c, n, { createdBy: PA[who].id, owner: PA[who].id });
  c.model.reply = { ok: true, text: agentJson(total(v)) };
  const done = c.extracted(id);
  const r = await c.call(who, "POST", `${CBASE}/${id}/extract`);
  expect({ status: r.status, code: errCode(r) }).toEqual({ status: 202, code: null });
  expect(await done).toBe("needs_review");
  const [a] = await c.sql<Json[]>`select a.mode, a.engine_run_id::text as run
    from contracts.approvals a join contracts.contracts k on k.run_id = a.id where k.id = ${id}`;
  expect(a?.mode).toBe("engine");
  await waitStatus(c.sql, a?.run as string, "waiting_review");
  return { id, run: a?.run as string };
}

const card = async (r: Role, id: string) => (await approval(c, r, id)).json as Json;
async function stepOpen(id: string, idx: number): Promise<void> {
  const j = await waitFor(
    () => card("A", id),
    (x) => x?.steps?.[idx]?.status === "open",
    10_000,
  );
  expect(j?.steps?.[idx]?.status).toBe("open");
}

describe("prod-fix2 · Toàn quyền quyết bước duyệt trên engine", () => {
  it("H (Toàn quyền, không thuộc Group cấp 1) Đạt bước 1 ⇒ HĐ Đã duyệt, người quyết = H", async () => {
    const { id, run } = await openBy("B", 781, 10_000_000);
    expect((await card("H", id)).can_act).toBe(true);
    expect((await act(c, "H", id, "approve")).status).toBe(200);
    await waitStatus(c.sql, run, "done");
    expect(await contractRow(c, id)).toMatchObject({ status: "active", confirmed_by: PA.H.id });
  }, 60_000);

  it("người gửi (H) vẫn bị chặn ở bước exclude_starter; A (Toàn quyền, không phải người gửi) duyệt được", async () => {
    const { id, run } = await openBy("H", 782, BIG);
    expect((await act(c, "B", id, "approve")).status).toBe(200);
    await stepOpen(id, 1);
    const asH = await card("H", id);
    expect({ can: asH.can_act, why: asH.block_reason }).toEqual({ can: false, why: "starter" });
    expect(errCode(await act(c, "H", id, "approve"))).toBe("STARTER_CANNOT_REVIEW");
    expect((await act(c, "A", id, "approve")).status).toBe(200);
    await waitStatus(c.sql, run, "done");
    expect((await contractRow(c, id)).status).toBe("active");
  }, 60_000);

  it("X (chỉ xem, ngoài cả hai nhóm) không quyết được bước 1", async () => {
    const { id } = await openBy("B", 783, 10_000_000);
    expect((await card("X", id)).can_act).toBe(false);
    const r = await act(c, "X", id, "approve");
    expect(r.status).not.toBe(200);
    expect((await contractRow(c, id)).status).toBe("needs_review");
  }, 60_000);
});
