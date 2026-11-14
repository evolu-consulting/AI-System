// CR-151c · DB thật: phân trang offset của «đợt mở» (sổ đối tác), «mốc mở» (chọn mốc khi tạo giao dịch) và «nhật ký sửa» —
// trang 2 đúng thứ tự, không trùng, trần, limit+1 biết còn trang, công ty khác không thấy.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../kit/adapters/pack-uow";
import { dealsRepo } from "./adapters/deals.repo";
import { ledgerReadRepo } from "./adapters/ledger-read.repo";
import { openMilestonesRepo } from "./adapters/open-milestones.repo";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let UA = "";
let UB = "";
let CID = "";
const N = 7;
const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    ledger: ledgerReadRepo(tx, t),
    open: openMilestonesRepo(tx, t),
    deals: dealsRepo(tx, t),
  }));
const as = (t: string, u: string) => ({ tenantId: t, userId: u });

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B] = (await tenants(o, 2, 1510)) as [string, string];
  [UA] = (await users(o, A, 1, { from: 1510 })) as [string];
  [UB] = (await users(o, B, 1, { from: 1511 })) as [string];
  [CID] = (await contracts(o, A, 1, { from: 1510, createdBy: UA, status: "done" })) as [string];
  await o`update contracts.contracts set doc_type = 'contract', effect = 'active', direction = 'sale',
    fields = ${o.json({ buyer_tax_id: { value: "0105100001" }, buyer_name: { value: "Đối tác" } } as never)}
    where id = ${CID}`;
  for (let i = 1; i <= N; i++) {
    await o`insert into contracts.obligations (tenant_id, contract_id, direction, kind, seq, due_date, amount, title)
      values (${A}, ${CID}, 'receive', 'payment', ${i}, ${`2026-12-${String(i).padStart(2, "0")}`}, 1000, ${`Đợt ${i}`})`;
    await o`insert into contracts.contract_edit_log (tenant_id, contract_id, field) values (${A}, ${CID}, ${`fld_${"abcdefg"[i - 1]}`})`;
  }
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-151c · phân trang offset", () => {
  it("mục 11 đợt mở: trang 2 đúng thứ tự, không trùng, limit+1 báo còn trang, công ty khác không thấy", async () => {
    const page = (limit: number, offset: number, t = A, u = UA) =>
      uow().tenant(as(t, u), ({ ledger }) =>
        ledger.obligations({ contract_id: CID, status: "open", limit, offset }),
      );
    const p1 = await page(4, 0);
    const p2 = await page(4, 3); // limit 4 = cỡ trang 3 + 1
    expect(p1.map((x) => x.due_date)).toEqual([
      "2026-12-01",
      "2026-12-02",
      "2026-12-03",
      "2026-12-04",
    ]);
    expect(p2.map((x) => x.due_date)).toEqual([
      "2026-12-04",
      "2026-12-05",
      "2026-12-06",
      "2026-12-07",
    ]);
    expect((await page(4, 6)).map((x) => x.due_date)).toEqual(["2026-12-07"]); // hết trang: < limit
    expect((await page(500, 0)).length).toBe(N); // không limit ⇒ như cũ
    expect(await page(4, 0, B, UB)).toEqual([]);
  });

  it("mục 16 mốc mở: trang 2 không trùng trang 1, công ty khác không thấy", async () => {
    const q = (limit: number, offset: number, t = A, u = UA) =>
      uow().tenant(as(t, u), ({ open }) =>
        open.list({ party_key: "tax:0105100001", direction: "sale", limit, offset }),
      );
    const p1 = await q(4, 0);
    const p2 = await q(4, 4);
    expect(p1.length).toBe(4);
    expect(p2.length).toBe(3);
    expect(new Set([...p1, ...p2].map((x) => x.obligation_id)).size).toBe(N);
    expect((await q(500, 0)).length).toBe(N);
    expect(await q(4, 0, B, UB)).toEqual([]);
  });

  it("mục 20 nhật ký sửa: limit+1 + offset, mới nhất trước, không trùng, công ty khác ⇒ null", async () => {
    const log = (limit: number, offset: number, t = A, u = UA) =>
      uow().tenant(as(t, u), ({ deals }) => deals.editLog(CID, limit, offset));
    const p1 = ((await log(3, 0)) ?? []) as { field: string }[];
    const p2 = ((await log(3, 3)) ?? []) as { field: string }[];
    const p3 = ((await log(3, 6)) ?? []) as { field: string }[];
    expect(p1.map((x) => x.field)).toEqual(["fld_g", "fld_f", "fld_e", "fld_d"]); // 3 + 1 hàng báo còn trang
    expect(p2.map((x) => x.field)).toEqual(["fld_d", "fld_c", "fld_b", "fld_a"]);
    expect(p3.map((x) => x.field)).toEqual(["fld_a"]);
    expect(await log(3, 0, B, UB)).toBeNull();
  });
});
