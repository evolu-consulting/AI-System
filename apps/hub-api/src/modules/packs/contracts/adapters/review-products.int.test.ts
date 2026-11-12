// CR-127 · FIX-Q1 · "Xác nhận & lưu" kèm `products` (gắn sản phẩm lúc xác nhận): HĐ DRAFT sửa được (BR-02) ⇒ gắn SP TRONG DRAFT cùng tx,
// TRƯỚC khi chuyển trạng thái (K4 chỉ khoá khi đã processing/done). Không quy trình ⇒ 409 NO_APPROVAL_FLOW (NF1); có quy trình ⇒ PROCESSING + SP gắn
// ngay ở bản nháp (không còn chờ bước duyệt cuối). Đường route `product-links` trên HĐ processing/done vẫn khoá (`content-lock.int`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { registerFlowEngine } from "../../kit/public";
import { reviewSave } from "../application/review.usecase";
import { packUow } from "../extraction.uow";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let hasFlow = false;

const gate = { prepare: async () => ({ on: true, departments: [] as string[] }) };
const engine = () => ({
  availability: { hasFlowFor: async () => hasFlow },
  runControl: { inspect: async () => null, cancel: async () => true },
});
const who = () => ({ tenantId: T, userId: U });
const save = () =>
  reviewSave({
    uow: packUow(db),
    today: async () => "2026-11-10",
    submit: { uow: packUow(db), gate, engine } as never,
  });

async function draftWithItem(): Promise<{ id: string; item: string }> {
  const id = crypto.randomUUID();
  const item = crypto.randomUUID();
  await o`insert into contracts.contracts ${o({ id, tenant_id: T, title: "HĐ FIX-Q1", created_by: U, status: "draft", extract_state: "ready", source_text: "Điều 1" } as never)}`;
  await o`insert into contracts.contract_items (id, tenant_id, contract_id, ord, name) values (${item}, ${T}, ${id}, 1, 'Thùng carton Q1')`;
  return { id, item };
}
const state = async (id: string, item: string) =>
  (
    await o<{ status: string; pid: string | null; pending: unknown }[]>`
      select c.status, i.product_id::text as pid,
        (select x.pending_links from contracts.approvals x where x.id = c.run_id) as pending
      from contracts.contracts c join contracts.contract_items i on i.contract_id = c.id and i.id = ${item}
      where c.id = ${id}`
  )[0];

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9431)) as [string];
  [U] = (await users(o, T, 1, { from: 9431 })) as [string];
  registerFlowEngine(engine() as never);
}, 120_000);

afterAll(async () => {
  registerFlowEngine(null);
  await db?.close();
  await o?.end({ timeout: 2 });
});

const input = (item: string, version: number) => ({
  version,
  deal: "buy" as const,
  products: [
    {
      item_id: item,
      new_product: { name: "Thùng carton Q1", unit: "thùng", group: "goods" as const },
    },
  ],
});

describe("CR-127 · review kèm products (gắn SP trong DRAFT, trước khi chuyển)", () => {
  it("không quy trình ⇒ NO_APPROVAL_FLOW (NF1): HĐ giữ Nháp, SP KHÔNG gắn (rollback cả lệnh)", async () => {
    hasFlow = false;
    const { id, item } = await draftWithItem();
    const out = await save()(who(), id, input(item, 1));
    expect(out).toMatchObject({ kind: "submit", code: "NO_APPROVAL_FLOW" });
    const s = await state(id, item);
    expect(s?.status).toBe("draft");
    expect(s?.pid).toBeNull();
  });

  it("có quy trình ⇒ PROCESSING + SP gắn ngay ở bản nháp", async () => {
    hasFlow = true;
    const { id, item } = await draftWithItem();
    const out = await save()(who(), id, input(item, 1));
    expect(out).toMatchObject({ kind: "ok", out: { status: "processing" } });
    const s = await state(id, item);
    expect(s?.status).toBe("processing");
    expect(s?.pid).not.toBeNull();
  });

  it("HĐ đã processing/done: gắn SP qua review ⇒ không đổi (khoá K4 giữ)", async () => {
    hasFlow = true;
    const { id, item } = await draftWithItem();
    await save()(who(), id, { version: 1, deal: "buy" });
    const [v] = await o<
      { version: number }[]
    >`select version from contracts.contracts where id = ${id}`;
    const again = await save()(who(), id, input(item, v?.version ?? 0));
    expect(again.kind).toBe("not_reviewable");
    expect((await state(id, item))?.pid).toBeNull();
  });
});
