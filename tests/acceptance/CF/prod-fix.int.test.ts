// contract-flow prod-fix (lỗi production 2026-10-27, cờ engine bật) · hub THẬT:
// #1 engine không mở được run khi người tải là thành viên thường (không admin) và tenant đã có run đang chờ duyệt (trần run/tenant
//    §4 đếm cả run duyệt của gói ⇒ `TOO_MANY_PROCESS_RUNS`) ⇒ lượt rơi về máy cũ. Run gắn gói không tính/không chịu trần.
// #2 tenant TẮT duyệt: đọc xong (job / vòng heal) KHÔNG mở lượt duyệt (máy cũ lẫn engine) ⇒ thẻ duyệt rỗng; "Xác nhận và lưu" =
//    một POST /review mang products ⇒ khoá + SP gắn.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { insItem } from "../HD1/_support/hd1";
import { agentJson, approval, CBASE, errCode, seedContract, total } from "../HD3/_hd3";
import { type Json, PA, type Role, T } from "../P-d/_support/pd";
import { type CtxCf, startCf } from "./_cf";

let c: CtxCf;
let had: boolean | null = null;
beforeAll(async () => {
  // Trần 1 run/tenant (như tenant thật có trần nhỏ): run duyệt thứ hai vẫn phải mở được.
  c = await startCf({}, { runsCap: 1 });
  const [h] = await c.sql<{ v: boolean | null }[]>`select approval_enabled as v
    from contracts.approval_settings where tenant_id = ${T.acme}`;
  had = h?.v ?? null;
}, 180_000);
afterAll(async () => {
  if (c)
    await c.sql`update contracts.approval_settings set approval_enabled = ${had} where tenant_id = ${T.acme}`;
  await c?.stop();
});

const setApproval = (on: boolean) =>
  c.sql`insert into contracts.approval_settings (tenant_id, approval_enabled) values (${T.acme}, ${on})
    on conflict (tenant_id) do update set approval_enabled = excluded.approval_enabled`;

/** `who` (chủ HĐ) bấm Đọc ⇒ chờ job đọc xong. */
async function readBy(who: Role, n: number, v: number): Promise<string> {
  const id = await seedContract(c, n, { createdBy: PA[who].id, owner: PA[who].id });
  c.model.reply = { ok: true, text: agentJson(total(v)) };
  const done = c.extracted(id);
  const r = await c.call(who, "POST", `${CBASE}/${id}/extract`);
  expect({ status: r.status, code: errCode(r) }).toEqual({ status: 202, code: null });
  expect(await done).toBe("needs_review");
  return id;
}

const approvalsOf = (id: string) =>
  c.sql<Json[]>`select status, mode, engine_run_id::text as run from contracts.approvals
    where contract_id = ${id} order by created_at`;
const liveOf = async (id: string) =>
  (
    await c.sql<{ n: number }[]>`select count(*)::int as n from contracts.approvals
      where contract_id = ${id} and status in ('extracting', 'level1', 'level2')`
  )[0]?.n;
const runsOf = async (id: string) =>
  (
    await c.sql<{ n: number }[]>`select count(*)::int as n from hub.process_runs
      where pack_key = 'contracts' and pack_record_id = ${id}`
  )[0]?.n;

describe("prod-fix #1 · thành viên thường mở run engine, trần run không chặn run duyệt của gói", () => {
  it("B (Group cấp 1, không admin) đọc 2 HĐ liên tiếp (trần 1) ⇒ cả hai lượt mode engine có run", async () => {
    await setApproval(true);
    const [b] = await c.sql<Json[]>`select role from admin.users where id = ${PA.B.id}`;
    expect(b?.role).not.toBe("tenant_admin");
    for (const n of [761, 762]) {
      const id = await readBy("B", n, 10_000_000);
      const [a] = await approvalsOf(id);
      expect({ n, s: a?.status, m: a?.mode, run: typeof a?.run }).toEqual({
        n,
        s: "level1",
        m: "engine",
        run: "string",
      });
    }
  }, 90_000);
});

describe("prod-fix #2 · tắt duyệt + cờ engine bật ⇒ không mở lượt duyệt", () => {
  it("đọc xong ⇒ không lượt sống, không run engine, thẻ duyệt bước = null; xác nhận kèm products ⇒ khoá + SP gắn", async () => {
    await setApproval(false);
    const id = await readBy("B", 763, 10_000_000);
    expect(await liveOf(id)).toBe(0);
    expect(await runsOf(id)).toBe(0);
    const g = await approval(c, "B", id);
    expect({ status: g.status, step: g.json?.step ?? null }).toEqual({ status: 200, step: null });
    const item = "e3000000-0000-4000-8000-000000000763";
    await insItem(c.sql, T.acme, id, 1, { id: item, name: "Thùng PF-763" } as never);
    const [k] = await c.sql<
      { v: number }[]
    >`select version as v from contracts.contracts where id = ${id}`;
    const r = await c.call("B", "POST", `${CBASE}/${id}/review`, {
      version: k?.v,
      products: [
        { item_id: item, new_product: { name: "Thùng PF-763", unit: "thùng", group: "goods" } },
      ],
    });
    expect({ status: r.status, s: r.json?.status }).toEqual({ status: 200, s: "active" });
    const [row] = await c.sql<Json[]>`select c.locked_at is not null as locked,
        (select product_id is not null from contracts.contract_items where id = ${item}) as linked
      from contracts.contracts c where c.id = ${id}`;
    expect(row).toEqual({ locked: true, linked: true });
  }, 60_000);

  it("vòng heal (lượt `extracting` mà HĐ đã đọc xong) ⇒ không mở cấp 1 / run engine", async () => {
    await setApproval(false);
    const id = await seedContract(c, 764, {
      status: "needs_review",
      createdBy: PA.B.id,
      owner: PA.B.id,
    });
    const aid = crypto.randomUUID();
    await c.sql`insert into contracts.approvals (id, tenant_id, contract_id, status, started_by)
      values (${aid}, ${T.acme}, ${id}, 'extracting', ${PA.B.id})`;
    await c.sql`update contracts.contracts set run_id = ${aid} where id = ${id}`;
    await c.sweepOnce();
    expect(await liveOf(id)).toBe(0);
    expect(await runsOf(id)).toBe(0);
    const g = await approval(c, "B", id);
    expect(g.json?.step ?? null).toBeNull();
  }, 60_000);
});
