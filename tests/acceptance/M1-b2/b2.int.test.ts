// M1D-FR-01 · HD7-FR-05 · docs/specs/M1e-fixes · UAT CR-095 B2 (Cao): người tạo HĐ "Nhập tay" (tự xác nhận cấp 1, chưa có đợt)
// phải ghi được việc cho đối tác của chính HĐ mình và thấy việc mình ghi; vẫn KHÔNG thấy sổ đối tác / khách CKS của người khác cho
// cùng MST (ca lạm dụng N-1). Chế độ `org`; acme: lan = owner gói · hoa = editor (người tạo) · tam = viewer.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { arrangeHd7, type CtxN1, call, deal, events, P, startHd1, T } from "../HD7/_support/hd7";

let c: CtxN1;
const TAX = "0311111999";
const PARTY = `tax:${TAX}`;

beforeAll(async () => {
  c = await startHd1();
}, 120_000);
afterAll(async () => {
  if (c) await c.sql`delete from contracts.visibility_settings where tenant_id = ${T.acme}`;
  await c?.stop();
});

async function world() {
  await arrangeHd7(c);
  // HĐ Gamma của hoa: nhập tay, không ngày (không có đợt mặc định), hoa tự xác nhận ⇒ active, người duyệt = người tạo.
  const mine = await deal(c.sql, {
    sale: true,
    partner: "Công ty Gamma",
    tax: TAX,
    value: 30_000_000,
  });
  await c.sql`update contracts.contracts set created_by = ${P.hoa.id}, owner_user_id = ${P.hoa.id},
    confirmed_by = ${P.hoa.id}, confirmed_at = now() where id = ${mine}`;
  // HĐ của lan cùng MST + sự kiện do lan ghi + khách CKS do lan tạo — hoa không được thấy.
  const theirs = await deal(c.sql, {
    sale: true,
    partner: "Công ty Gamma",
    tax: TAX,
    number: "L-1",
  });
  await c.sql`insert into contracts.partner_events (tenant_id, party_key, role, type, at, by_user, contract_id, note)
    values (${T.acme}, ${PARTY}, 'customer', 'complaint', '2026-10-01', ${P.lan.id}, ${theirs}, 'của lan')`;
  await c.sql`delete from contracts.cks_customers where tenant_id = ${T.acme} and tax_id = ${TAX}`;
  await c.sql`insert into contracts.cks_customers (tenant_id, name, tax_id, created_by)
    values (${T.acme}, 'Công ty Gamma', ${TAX}, ${P.lan.id})`;
  await c.sql`insert into contracts.visibility_settings (tenant_id, mode) values (${T.acme}, 'org')
    on conflict (tenant_id) do update set mode = 'org'`;
  return { mine, theirs };
}

describe("UAT B2 · người tạo làm việc với đối tác của HĐ mình (chế độ org)", () => {
  it("hoa ghi việc cho Gamma gắn HĐ của mình ⇒ 201; thấy đúng việc mình ghi, không thấy việc / khách CKS của lan", async () => {
    const { mine } = await world();
    const r = await call(c, P.hoa, "POST", "/partner-events", {
      party: PARTY,
      role: "customer",
      type: "complaint",
      contract_id: mine,
      note: "của hoa",
    });
    const seen = (await events(c, PARTY, P.hoa)).map((e) => e.note);
    const [cust] = await c.sql<
      { n: number }[]
    >`select count(*)::int as n from contracts.cks_customers
      where tax_id = ${TAX}`;
    const cks = await call(c, P.hoa, "GET", "/cks/customers");
    expect({
      status: r.status,
      seen,
      lanSees: (await events(c, PARTY, P.lan)).length,
      custRows: cust?.n,
      hoaCks: cks.json.total,
    }).toEqual({ status: 201, seen: ["của hoa"], lanSees: 2, custRows: 1, hoaCks: 0 });
  });
  it("không có HĐ nào của mình mang MST đó ⇒ vẫn 404 (không ghi việc cho đối tác người khác)", async () => {
    await world();
    const r = await call(c, P.hoa, "POST", "/partner-events", {
      party: "tax:0399999999",
      role: "customer",
      type: "complaint",
    });
    expect(r.status).toBe(404);
  });
});
