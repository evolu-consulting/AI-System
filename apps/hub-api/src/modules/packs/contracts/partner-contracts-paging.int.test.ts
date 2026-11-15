// CR-151d mục 12 (+21 lịch sử HĐ) · DB thật: tab «Hợp đồng» của đối tác phân trang offset — trang 2 đúng thứ tự, không trùng,
// limit+1 báo còn trang, hết trang < limit, công ty khác không thấy.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../kit/adapters/pack-uow";
import { activityRepo } from "./adapters/activity.repo";
import { partnerRolesRepo } from "./adapters/partner-roles.repo";

const PARTY = "tax:0105100099";
const N = 7;
let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let UB = "";
let HID = "";
const as = (t: string, u: string) => ({ tenantId: t, userId: u });
const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    roles: partnerRolesRepo(tx, t),
    act: activityRepo(tx, t),
  }));

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 1520)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 1520 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1521 })) as [string];
  const ids = (await contracts(o, A, N, { from: 1520, createdBy: UA, status: "done" })) as string[];
  for (const [i, id] of ids.entries())
    await o`update contracts.contracts set doc_type = 'contract', effect = 'active', direction = 'sale',
      fields = ${o.json({ buyer_tax_id: { value: "0105100099" }, buyer_name: { value: "Đối tác" } } as never)},
      updated_at = ${`2026-11-${String(i + 1).padStart(2, "0")}T00:00:00Z`} where id = ${id}`;
  HID = ids[0] as string;
  for (let i = 1; i <= N; i++)
    await o`insert into contracts.contract_events (tenant_id, contract_id, type, actor_user_id, data, at)
      values (${A}, ${HID}, 'owner_assigned', ${UA}, '{}'::jsonb, ${`2030-01-0${i}T00:00:00Z`})`;
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-151d · mục 12 HĐ của đối tác", () => {
  const page = (limit: number, offset: number, t = A, u = UA) =>
    uow().tenant(as(t, u), ({ roles }) => roles.contracts(PARTY, limit, offset));

  it("trang 2 đúng thứ tự (mới cập nhật trước), không trùng trang 1, hết trang < limit", async () => {
    const p1 = await page(4, 0); // 3 + 1 báo còn trang
    const p2 = await page(4, 3);
    const p3 = await page(4, 6);
    expect(p1.length).toBe(4);
    expect(p2.length).toBe(4);
    expect(p3.length).toBe(1);
    const ids = [...p1.slice(0, 3), ...p2.slice(0, 3), ...p3].map((x) => x.id);
    expect(new Set(ids).size).toBe(N);
    expect(p2[0]?.id).toBe(p1[3]?.id); // hàng thừa của trang 1 = hàng đầu trang 2
  });

  it("trần 200 ở hợp đồng; công ty khác không thấy", async () => {
    expect((await page(200, 0)).length).toBe(N);
    expect(await page(4, 0, B, UB)).toEqual([]);
  });
});

describe("CR-151d · mục 21 lịch sử HĐ", () => {
  const hist = async (limit: number, offset: number, t = A, u = UA) =>
    (
      (await uow().tenant(as(t, u), ({ act }) =>
        act.activity.record({ id: HID, number: null }, limit, offset),
      )) as { events: { at: string }[] }[]
    )[0]?.events.map((e) => e.at.slice(0, 10)) ?? [];

  it("trang 2 mới nhất trước, không trùng, limit+1 báo còn trang, hết trang < limit", async () => {
    const all = await hist(200, 0);
    expect(all.filter((x) => x.startsWith("2030-01-0")).length).toBe(N);
    expect(all.slice(0, N)).toEqual([7, 6, 5, 4, 3, 2, 1].map((i) => `2030-01-0${i}`)); // mới nhất trước
    const p1 = await hist(4, 0);
    const p2 = await hist(4, 3);
    expect(p1.length).toBe(4);
    expect(p2[0]).toBe(p1[3]);
    expect([...p1.slice(0, 3), ...p2.slice(0, 3)]).toEqual(all.slice(0, 6)); // không trùng, không sót
    expect((await hist(4, all.length - 1)).length).toBe(1);
  });

  it("công ty khác không thấy lịch sử", async () => {
    expect(await hist(4, 0, B, UB)).toEqual([]);
  });
});
