// V2-H · BA v2 §3.3 SP-03 · §5.8 · §5.9 — đường chính mỗi endpoint mới (hub-api THẬT in-process): khách đang dùng của SP (Hết hạn /
// Sắp hết hạn theo số ngày nhắc của HĐ hoặc mặc định Cài đặt / Còn hạn), "Nhắc gia hạn" ⇒ việc "Liên hệ mời gia hạn" trong Cần xử lý
// ⇒ Đã xong, Cài đặt kinh doanh (mặc định 60), CKS chỉ đọc (Q4). HĐ + dòng dựng bằng owner (trigger khách đang dùng chạy như khi lưu).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeV2d,
  type CtxN1,
  call,
  d,
  deal,
  item,
  type Json,
  ok,
  P,
  product,
  startHd1,
  T,
} from "../V2-D/_support/v2d";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  if (c) await c.sql`delete from contracts.business_settings`;
  await c?.stop();
});

const fv = (value: number) => ({ value, quote: "", verified: true, edited: true });

async function arrange() {
  await arrangeV2d(c);
  await c.sql`delete from contracts.business_settings`;
  const p = await product(c.sql, { name: "Chữ ký số 1 năm", grp: "service" });
  const sold = async (partner: string, end: string, notice?: number) => {
    const k = await deal(c.sql, { sale: true, partner, end });
    if (notice !== undefined)
      await c.sql`update contracts.contracts set fields = jsonb_set(fields, '{notice_days}', ${c.sql.json(fv(notice))})
        where id = ${k}`;
    await item(c.sql, k, { qty: 1, price: 500_000, productId: p.id });
  };
  await sold("Khách Hết", d(-5));
  await sold("Khách Sắp", d(20));
  await sold("Khách Còn", d(100));
  await sold("Khách Báo Trước", d(100), 120);
  return p.id;
}

const customers = (pid: string) => ok(call(c, P.tam, "GET", `/products/${pid}/customers`));
const byName = (out: Json) =>
  Object.fromEntries(
    (out.items as Json[]).map((x) => [x.customer_name, [x.status, x.days_left, x.reminded]]),
  );

describe("V2-H · khách đang dùng + nhắc gia hạn", () => {
  it("phân loại theo số ngày nhắc (HĐ ghi 120 thắng mặc định 60); Nhắc gia hạn ⇒ Cần xử lý ⇒ Đã xong", async () => {
    const pid = await arrange();
    const out = await customers(pid);
    expect([out.notice_default, out.counts]).toEqual([
      60,
      { all: 4, expired: 1, soon: 2, active: 1 },
    ]);
    expect(byName(out)).toEqual({
      "Khách Hết": ["expired", -5, false],
      "Khách Sắp": ["soon", 20, false],
      "Khách Còn": ["active", 100, false],
      "Khách Báo Trước": ["soon", 100, false],
    });
    const target = (out.items as Json[]).find((x) => x.customer_name === "Khách Sắp") as Json;
    const r = await call(c, P.tam, "POST", `/products/${pid}/customers/${target.id}/remind`, {});
    expect([r.status, r.json.title]).toEqual([
      201,
      "Liên hệ Khách Sắp mời gia hạn Chữ ký số 1 năm",
    ]);
    expect(byName(await customers(pid))["Khách Sắp"]).toEqual(["soon", 20, true]);
    const work = await ok(call(c, P.tam, "GET", "/my-work"));
    const task = (work.items as Json[]).find((x) => x.title === r.json.title) as Json;
    expect([task?.kind, task?.days]).toEqual(["followup", 0]);
    await ok(
      call(c, P.tam, "POST", `/my-work/followups/${String(task.id).split(":")[1]}/done`, {}),
    );
    expect(byName(await customers(pid))["Khách Sắp"]).toEqual(["soon", 20, false]);
  });

  it("Cài đặt: mặc định 60; quản lý đặt 30 ⇒ tab dùng 30 cho HĐ không ghi số ngày nhắc", async () => {
    const pid = await arrange();
    expect(await ok(call(c, P.tam, "GET", "/business-settings"))).toEqual({
      renewal_notice_days: 60,
    });
    await ok(call(c, P.lan, "PUT", "/business-settings", { renewal_notice_days: 30 }));
    expect(await ok(call(c, P.tam, "GET", "/business-settings"))).toEqual({
      renewal_notice_days: 30,
    });
    const out = await customers(pid);
    expect([out.notice_default, out.counts]).toEqual([
      30,
      { all: 4, expired: 1, soon: 2, active: 1 },
    ]);
    expect(byName(out)["Khách Sắp"]?.[0]).toBe("soon");
  });

  it("CKS chỉ đọc khi tenant tắt ghi (Q4): POST ⇒ 410 CKS_READ_ONLY, GET vẫn 200", async () => {
    await c.sql`insert into contracts.business_settings (tenant_id, cks_writable) values (${T.acme}, false)
      on conflict (tenant_id) do update set cks_writable = false`;
    const w = await call(c, P.hoa, "POST", "/cks/lots", {
      ca: "Viettel-CA",
      qty: 1,
      unit_cost: 1,
      bought_at: d(-1),
      device: "token",
    });
    expect([w.status, w.json.error?.code]).toEqual([410, "CKS_READ_ONLY"]);
    expect((await call(c, P.tam, "GET", "/cks/overview")).status).toBe(200);
    // V2-O (0036): không có hàng cài đặt ⇒ vẫn chỉ đọc (mặc định toàn cục, không riêng nitigroup/demo).
    await c.sql`delete from contracts.business_settings where tenant_id = ${T.acme}`;
    const d2 = await call(c, P.hoa, "POST", "/cks/lots", {
      ca: "Viettel-CA",
      qty: 1,
      unit_cost: 1,
      bought_at: d(-1),
      device: "token",
    });
    expect([d2.status, d2.json.error?.code]).toEqual([410, "CKS_READ_ONLY"]);
  });
});
