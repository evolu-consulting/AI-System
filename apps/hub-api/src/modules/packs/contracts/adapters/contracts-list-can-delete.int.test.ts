// CR-128 L1: `can_delete` mỗi hàng danh sách = `canDeleteContract` (một nguồn với chi tiết/guard xoá). DB thật (pool hub_api + RLS).
// Người tạo (có quyền ghi): nháp true, HĐ đã gửi false · người khác: false · quản trị gói: true mọi HĐ · không truyền ngữ cảnh ⇒ không có khoá.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import type { ContractListFilter } from "../application/ports";
import type { ListDeleteCtx } from "../domain/delete-contract.rules";
import { contractsRepo } from "./contracts.repo";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let OTHER = "";

const uow = () => createPackUow(db, "contracts", (tx, tid) => ({ list: contractsRepo(tx, tid) }));
const filter: ContractListFilter = {
  status: null,
  effect: null,
  owner: null,
  category: null,
  seller: null,
  buyer: null,
  signerKeys: null,
  direction: null,
  kind: null,
  valueMin: null,
  valueMax: null,
  dateField: "end_date",
  dateFrom: null,
  dateTo: null,
  like: null,
  order: "title:asc",
  limit: 50,
  offset: 0,
};
const rows = async (del?: ListDeleteCtx) => {
  const p = await uow().tenant({ tenantId: T, userId: U }, (r) =>
    r.list.list(filter, undefined, del),
  );
  return new Map(
    p.items.map((i) => [
      (i as { title: string }).title,
      (i as { can_delete?: boolean }).can_delete,
    ]),
  );
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T] = (await tenants(o, 1, 9129)) as [string];
  [U, OTHER] = (await users(o, T, 2, { from: 9129 })) as [string, string];
  const mk = (title: string, status: string, by: string) =>
    o`insert into contracts.contracts ${o({ tenant_id: T, title, created_by: by, owner_user_id: by, status } as never)}`;
  await mk("A-draft", "draft", U);
  await mk("B-processing", "processing", U);
  await mk("C-draft-other", "draft", OTHER);
}, 120_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-128 L1 · can_delete ở danh sách", () => {
  it("người tạo có quyền ghi: nháp của mình true; đã gửi false; nháp người khác false", async () => {
    const m = await rows({ actor: U, role: { admin: false, write: true } });
    expect(m.get("A-draft")).toBe(true);
    expect(m.get("B-processing")).toBe(false);
    expect(m.get("C-draft-other")).toBe(false);
  });
  it("quản trị gói: true với mọi HĐ", async () => {
    const m = await rows({ actor: U, role: { admin: true, write: true } });
    expect([...m.values()]).toEqual([true, true, true]);
  });
  it("không có ngữ cảnh ⇒ không khoá can_delete", async () => {
    expect([...(await rows()).values()]).toEqual([undefined, undefined, undefined]);
  });
});
