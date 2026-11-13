// CR-140 · node «Ghi thanh toán vào HĐ», DB thật (pool hub_api, role contracts_rw): bước chi tiền xong mà HĐ không có đợt thanh toán ⇒ MỘT dòng
// «đã trả» trong sổ thanh toán của HĐ (`contracts.obligations`) + sổ đối tác + nhật ký; thử lại cùng lượt không ghi đôi; HĐ có đợt đang mở thì không
// ghi thêm; công ty khác không ghi được vào HĐ của công ty này.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { contracts, tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { recordPaymentRepo } from "./contracts/adapters/record-payment.repo";
import { recordPaymentTool } from "./contracts/adapters/record-payment.tool";
import { createPackUow } from "./kit/adapters/pack-uow";
import { packTenantOnly } from "./kit/public";

let o: Sql;
let db: Db;
let T1 = "";
let T2 = "";
let A = "";
let X = "";
let C1 = "";
let C2 = "";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [T1, T2] = (await tenants(o, 2, 1401)) as [string, string];
  [A] = (await users(o, T1, 1, { from: 1401 })) as [string];
  [X] = (await users(o, T2, 1, { from: 1411 })) as [string];
  [C1, C2] = (await contracts(o, T1, 2, { createdBy: A, owner: A, from: 1401 })) as [
    string,
    string,
  ];
  await o`update contracts.contracts set fields = jsonb_build_object(
      'supplier_name', jsonb_build_object('value', 'Công ty Cung Ứng'),
      'total_value', jsonb_build_object('value', '7000000'))
    where tenant_id = ${T1} and id in (${C1}, ${C2})`;
  db = createDb(urls().hubApi, { max: 4 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const tool = () =>
  recordPaymentTool({
    uow: packTenantOnly(createPackUow(db, "contracts", recordPaymentRepo)),
    timeZoneOf: async () => "Asia/Ho_Chi_Minh",
  });
const ctx = (tenantId: string, userId: string, processRunId: string | null) => ({
  tenantId,
  userId,
  runId: null,
  processRunId,
});
const rows = (t: string, c: string) =>
  o`select kind, direction, status, amount::text as amount, done_at::text as done_at, done_by::text as by, source,
      party_key from contracts.obligations where tenant_id = ${t} and contract_id = ${c} order by seq`;

describe("contracts-record-payment", () => {
  it("HĐ không có đợt: ghi một dòng «đã trả»; thử lại cùng lượt không ghi đôi; HĐ có đợt mở thì không ghi thêm", async () => {
    const run = Bun.randomUUIDv7();
    const r = await tool().run(ctx(T1, A, run), {
      contract_id: C1,
      amount: 5_000_000,
      paid_at: "2026-11-05",
    });
    expect(r).toMatchObject({ status: "recorded", contract_id: C1 });
    expect([...(await rows(T1, C1))]).toEqual([
      {
        kind: "payment",
        direction: "pay",
        status: "done",
        amount: "5000000",
        done_at: "2026-11-05",
        by: A,
        source: "fulfill",
        party_key: expect.stringMatching(/^name:/),
      },
    ]);
    const [ev] =
      await o`select count(*)::int as n, max(amount)::text as amount from contracts.partner_events
      where tenant_id = ${T1} and contract_id = ${C1} and type = 'paid'`;
    expect(ev).toEqual({ n: 1, amount: "5000000" });

    // thử lại (engine retry) ⇒ không ghi trùng
    const again = await tool().run(ctx(T1, A, run), {
      contract_id: C1,
      amount: 5_000_000,
      paid_at: "2026-11-05",
    });
    expect(again).toMatchObject({ status: "exists" });
    expect((await rows(T1, C1)).length).toBe(1);

    // thiếu số tiền ⇒ lấy giá trị HĐ; lượt khác = khoản chi khác
    await tool().run(ctx(T1, A, Bun.randomUUIDv7()), { contract_id: C1, paid_at: "2026-11-06" });
    const all = await rows(T1, C1);
    expect(all.map((x) => x.amount)).toEqual(["5000000", "7000000"]);

    // HĐ có đợt thanh toán đang mở ⇒ để «Xác nhận mốc» lo, không ghi thêm
    await o`insert into contracts.obligations (tenant_id, contract_id, direction, kind, seq, due_date, amount, title)
      values (${T1}, ${C2}, 'pay', 'payment', 1, '2026-11-10', 1000, 'Đợt 1')`;
    const sch = await tool().run(ctx(T1, A, Bun.randomUUIDv7()), { contract_id: C2, amount: 1000 });
    expect(sch).toMatchObject({ status: "has_schedule" });
    expect((await rows(T1, C2)).map((x) => x.status)).toEqual(["open"]);
  });

  it("chặn chéo công ty: lượt của công ty khác không ghi được vào HĐ của công ty này", async () => {
    const before = (await rows(T1, C1)).length;
    await expect(
      tool().run(ctx(T2, X, Bun.randomUUIDv7()), { contract_id: C1, amount: 1 }),
    ).rejects.toThrow("CONTRACT_PAYMENT_NO_CONTRACT");
    expect((await rows(T1, C1)).length).toBe(before);
    expect(
      (await o`select count(*)::int as n from contracts.obligations where tenant_id = ${T2}`)[0]?.n,
    ).toBe(0);
  });
});
