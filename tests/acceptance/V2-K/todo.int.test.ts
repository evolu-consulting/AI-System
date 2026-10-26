// V2-K · TQ-01 · BA §5.9: `GET /my-work/todo` đường chính — 8 nguồn (quá hạn đầu) + `POST /my-work/todo/dismiss` (Bỏ qua ẩn việc
// của riêng mình; Đã xong việc Liên hệ mời gia hạn đóng hẹn nhắc); khoá sai ⇒ 400; Bỏ qua của lan không ẩn việc của hoa.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import postgres from "postgres";
import { HUB_API_URL } from "../H1/_fixtures";
import {
  arrangeV2k,
  type CtxN1,
  contract,
  d,
  dismissRaw,
  milestone,
  ok,
  P,
  product,
  startHd1,
  T,
  todo,
} from "./_support/v2k";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

type Item = { key: string; kind: string; contract_id: string | null; product_id: string | null };

describe("V2-K · Cần xử lý 8 nguồn", () => {
  it("đủ 8 loại, quá hạn đầu; Bỏ qua / Đã xong ẩn đúng việc của đúng người", async () => {
    await arrangeV2k(c);
    const sale = await contract(c.sql, { deal: "sell", end: d(10), notice: 30 });
    await milestone(c.sql, sale, { kind: "delivery", due: d(-3) });
    await milestone(c.sql, sale, { kind: "collect", due: d(2) });
    const ref = await contract(c.sql, { deal: "referral", pct: 5 });
    await milestone(c.sql, ref, { kind: "commission", due: d(-1) });
    const fin = await contract(c.sql, { deal: "buy" });
    await milestone(c.sql, fin, { kind: "delivery", due: d(-6), done: d(-5) });
    const svc = await product(c.sql, { name: "Chữ ký số", grp: "service" });
    const [sc] = await c.sql<{ id: string }[]>`insert into contracts.service_customers
        (tenant_id, product_id, party_key, customer_name, contract_id, expires_on)
      values (${T.acme}, ${svc.id}, 'name:khach a', 'Khách A', ${sale}, ${d(20)}) returning id::text`;
    const [fu] = await c.sql<{ id: string }[]>`insert into contracts.followups
        (tenant_id, user_id, subject_kind, subject_id, due_at, title)
      values (${T.acme}, ${P.lan.id}, 'renewal', ${sc?.id as string}, now(), 'Liên hệ Khách A mời gia hạn')
      returning id::text`;

    const r = await todo(c);
    const kinds = new Set(r.items.map((i: Item) => i.kind));
    expect([...kinds].sort()).toEqual(
      [
        "commission",
        "contract_expiring",
        "customers_expiring",
        "due_soon",
        "missing_file",
        "overdue",
        "renewal_contact",
      ].sort(),
    );
    expect(r.items[0].kind).toBe("overdue");
    expect(r.counts.overdue).toBe(1);
    const of = (k: string) => r.items.find((i: Item) => i.kind === k) as Item;
    expect(of("customers_expiring").product_id).toBe(svc.id);
    // CR-097 U3: không còn việc "Đánh giá đối tác" (hết ô chấm sao, R41).
    expect(r.items.map((i: Item) => i.kind)).not.toContain("rating");
    expect(r.items.map((i: Item) => i.kind)).not.toContain("rating_quarter");

    await ok(dismissRaw(c, of("renewal_contact").key, "done"));
    const after = (await todo(c)).items.map((i: Item) => i.kind);
    expect(after).not.toContain("renewal_contact");
    const [f] = await c.sql<
      { status: string }[]
    >`select status from contracts.followups where id = ${fu?.id as string}`;
    expect(f?.status).toBe("done");
    expect((await dismissRaw(c, "overdue:x:2026-01-01", "skip")).status).toBe(400);
  });

  it("RLS `todo_dismissals`: tenant khác (role gói) không đọc được hàng của acme", async () => {
    await arrangeV2k(c);
    const key = `missing_file:${"0".repeat(8)}-0000-4000-8000-${"0".repeat(12)}:2026-01-01`;
    await ok(dismissRaw(c, key, "skip"));
    const conn = postgres(HUB_API_URL, { max: 1, onnotice: () => {} });
    try {
      const n = await conn.begin(async (tx) => {
        await tx`select set_config('role', 'contracts_rw', true), set_config('app.tenant_id', ${T.beta}, true),
          set_config('app.user_id', ${P.lan.id}, true)`;
        return (await tx`select count(*)::int as n from contracts.todo_dismissals`)[0]?.n;
      });
      expect(n).toBe(0);
    } finally {
      await conn.end({ timeout: 1 });
    }
    const [own] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.todo_dismissals`;
    expect(own?.n).toBe(1);
  });
});
