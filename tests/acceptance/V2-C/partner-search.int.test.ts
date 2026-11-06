// CR-122 p10: `GET /pack/contracts/partners/search?q=&role=&limit=` — ô Nhà cung cấp/Đối tác chọn từ sổ đối tác.
// Một đường chính (tiền tố tên / MST, lọc vai theo loại HĐ, limit) + chặn đọc chéo tenant.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  arrangeHd8,
  type CtxN1,
  call,
  deal,
  type Json,
  ok,
  P,
  startHd1,
  T,
} from "../HD8/_support/hd8";

let c: CtxN1;
beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  await c?.stop();
});

const enc = encodeURIComponent;
const names = (r: Json[]) => r.map((x: Json) => x.name);

describe("CR-122 p10 · tìm đối tác trong sổ", () => {
  it("lọc theo vai và tiền tố tên hoặc MST có limit và không lộ tenant khác", async () => {
    await arrangeHd8(c);
    await c.sql`truncate contracts.partner_roles, contracts.partner_notes`;
    await deal(c.sql, { sale: false, partner: "GSM Group", tax: "0311110001" });
    await deal(c.sql, { sale: false, partner: "Gỗ Sài Gòn", tax: "0311110002" });
    await deal(c.sql, { sale: true, partner: "GSM Khách Hàng", tax: "0311110003" });
    await c.sql`insert into contracts.partner_roles (tenant_id, party_key, role, name)
      values (${T.beta}, 'tax:0399999999', 'supplier', 'GSM Tenant Khác')`;

    // Mua ⇒ vai NCC; "gsm" khớp tiền tố, không lấy khách hàng, không lấy tenant khác
    let r: Json[] = await ok(
      call(c, P.lan, "GET", `/partners/search?q=${enc("gsm")}&role=supplier`),
    );
    expect(names(r)).toEqual(["GSM Group"]);
    expect(r[0]?.tax_id).toBe("0311110001");
    // Bán ⇒ vai Khách hàng
    r = await ok(call(c, P.lan, "GET", `/partners/search?q=GSM&role=customer`));
    expect(names(r)).toEqual(["GSM Khách Hàng"]);
    // có dấu ⇒ khớp không dấu; MST theo tiền tố
    r = await ok(call(c, P.lan, "GET", `/partners/search?q=${enc("gỗ")}&role=supplier`));
    expect(names(r)).toEqual(["Gỗ Sài Gòn"]);
    r = await ok(call(c, P.lan, "GET", `/partners/search?q=0311110002&role=supplier`));
    expect(names(r)).toEqual(["Gỗ Sài Gòn"]);
    // q rỗng = mở danh sách; limit cứng
    r = await ok(call(c, P.lan, "GET", `/partners/search?q=&role=supplier&limit=1`));
    expect(r.length).toBe(1);
    // đầu vào sai ⇒ 400
    expect((await call(c, P.lan, "GET", "/partners/search?role=lend")).status).toBe(400);
    expect((await call(c, P.lan, "GET", "/partners/search?limit=500")).status).toBe(400);
  });
});
