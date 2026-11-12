// CR-127 · K7 · BR-43/56 · spec §2.2: (DB thật, role gói `contracts_rw` + RLS)
// (1) lưu kết quả trích ⇒ `penalty_terms` (số) ghi bảng riêng, trích lại thay hàng `ai`; bản cũ (null) không đụng; (2) HĐ vào DONE ⇒ hook
// lập mốc AI kèm điều khoản gốc, chạy lại không trùng, mốc chuyển từ bản cũ không bị tạo đôi; (3) chặn chéo tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { contracts, tenants, users, visibility } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { connectDb, type Db } from "../../../../lib/db";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { aiMilestonesDoneHook } from "./ai-milestones.repo";
import { extractionRepo } from "./extraction.repo";

let o: Sql;
let db: Db;
let T = "";
let U = "";
let T2 = "";
let U2 = "";

const uow = () =>
  createPackUow(db, "contracts", (tx, tid) => ({ ex: extractionRepo(tx, tid), tx, tid }));
const TERM = {
  party: "partner" as const,
  trigger: "late_delivery" as const,
  rate_pct: 0.5,
  basis: "per_day_of_value" as const,
  cap_pct: 8,
  cap_amount: null,
  clause_ref: "Điều 7",
  page: 4,
  quote: "phạt 0,5%/ngày",
};
const AI = {
  deal: "sell",
  unsure: [],
  summary: null,
  milestones: [
    {
      kind: "delivery",
      title: "Giao",
      due_date: "2026-12-01",
      amount: null,
      quote: "q",
      clause_ref: "Điều 4",
      page: 2,
    },
    {
      kind: "collect",
      title: "Thu",
      due_date: "2026-12-15",
      amount: 5000000,
      quote: "q",
      clause_ref: "Điều 5",
      page: 3,
    },
    { kind: "other", title: "Không hạn", due_date: null, amount: null, quote: "q" },
  ],
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  [T, T2] = (await tenants(o, 2, 9127)) as [string, string];
  [U] = (await users(o, T, 1, { from: 9127 })) as [string];
  [U2] = (await users(o, T2, 1, { from: 9227 })) as [string];
  await visibility(o, [T, T2], "tenant");
});
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const termsOf = (tenant: string, id: string) =>
  uow().tenant({ tenantId: tenant, userId: U }, async (r) =>
    r.tx.execute<{ rate_pct: string; cap_pct: string; source: string; page: number }>(
      (await import("drizzle-orm"))
        .sql`select rate_pct, cap_pct, source, page from contracts.penalty_terms where contract_id = ${id}::uuid`,
    ),
  );

describe("CR-127 K7 · penalty_terms", () => {
  it("saveResult lưu phạt số; trích lại thay hàng ai; null không đụng; tenant khác không thấy", async () => {
    const [id] = (await contracts(o, T, 1, { createdBy: U, from: 9301, status: "draft" })) as [
      string,
    ];
    await o`update contracts.contracts set extract_state = 'reading' where id = ${id}`;
    const version = (await o`select version from contracts.contracts where id = ${id}`)[0]?.version;
    const base = { fields: {}, items: null, clauses: [], warnings: [], ai: null } as never;
    const ok = await uow().tenant({ tenantId: T, userId: U }, (r) =>
      r.ex.saveResult(id, {
        ...(base as object),
        expected: version,
        penaltyTerms: [TERM],
      } as never),
    );
    expect(ok).toBe(true);
    const rows = await termsOf(T, id);
    expect(rows.length).toBe(1);
    expect(Number(rows[0]?.rate_pct)).toBe(0.5);
    expect(rows[0]?.source).toBe("ai");
    expect((await termsOf(T2, id)).length).toBe(0); // RLS
    // trích lại với null ⇒ giữ nguyên
    await o`update contracts.contracts set extract_state = 'reading' where id = ${id}`;
    const v2 = (await o`select version from contracts.contracts where id = ${id}`)[0]?.version;
    await uow().tenant({ tenantId: T, userId: U }, (r) =>
      r.ex.saveResult(id, { ...(base as object), expected: v2, penaltyTerms: null } as never),
    );
    expect((await termsOf(T, id)).length).toBe(1);
  });
});

describe("CR-127 K7 · hook vào DONE lập mốc AI", () => {
  const run = (tenant: string, id: string) =>
    uow().tenant({ tenantId: tenant, userId: U }, (r) =>
      aiMilestonesDoneHook.onDone(r.tx, tenant, id),
    );
  const obs = (id: string) =>
    o`select kind, direction, seq, source, clause_ref, page, amount from contracts.obligations where contract_id = ${id} order by seq`;

  it("lập 2 mốc có hạn (bỏ mốc không hạn), kèm điều khoản; chạy lại không trùng", async () => {
    const [id] = (await contracts(o, T, 1, { createdBy: U, from: 9311, status: "done" })) as [
      string,
    ];
    await o`update contracts.contracts set ai_read = ${o.json(AI)}, deal = 'sell', direction = 'sale' where id = ${id}`;
    await run(T, id);
    await run(T, id);
    const rows = await obs(id);
    expect(rows.length).toBe(2);
    expect(rows[0]).toMatchObject({
      kind: "delivery",
      direction: "receive",
      seq: 1,
      source: "ai",
      clause_ref: "Điều 4",
      page: 2,
    });
    expect(rows[1]).toMatchObject({
      kind: "payment",
      direction: "receive",
      seq: 2,
      clause_ref: "Điều 5",
    });
    expect(Number(rows[1]?.amount)).toBe(5000000);
  });

  it("mốc đã chuyển từ bản cũ (cùng kind + seq) ⇒ không tạo đôi", async () => {
    const [id] = (await contracts(o, T, 1, { createdBy: U, from: 9321, status: "done" })) as [
      string,
    ];
    await o`update contracts.contracts set ai_read = ${o.json(AI)}, deal = 'sell', direction = 'sale' where id = ${id}`;
    await o`insert into contracts.obligations (tenant_id, contract_id, direction, kind, seq, due_date, source)
      values (${T}, ${id}, 'receive', 'delivery', 1, '2026-12-05', 'ai')`;
    await run(T, id);
    const rows = await obs(id);
    expect(rows.map((x) => x.kind)).toEqual(["delivery", "payment"]);
  });

  it("HĐ không phải done ⇒ không lập; tenant khác gọi ⇒ không lập", async () => {
    const [id] = (await contracts(o, T, 1, { createdBy: U, from: 9331, status: "draft" })) as [
      string,
    ];
    await o`update contracts.contracts set ai_read = ${o.json(AI)} where id = ${id}`;
    await run(T, id);
    expect((await obs(id)).length).toBe(0);
    const [id2] = (await contracts(o, T, 1, { createdBy: U, from: 9341, status: "done" })) as [
      string,
    ];
    await o`update contracts.contracts set ai_read = ${o.json(AI)} where id = ${id2}`;
    await uow().tenant({ tenantId: T2, userId: U2 }, (r) =>
      aiMilestonesDoneHook.onDone(r.tx, T2, id2),
    );
    expect((await obs(id2)).length).toBe(0);
  });
});
