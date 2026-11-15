// diag-s12-s18 · CR-161 R-«Đã kết nối: hiện trong Đối tác, gửi HĐ đi thẳng»: công ty ĐÃ KẾT NỐI (hai chiều `hub.partner_links`) mà CHƯA có HĐ / chưa thêm ở
// sổ đối tác vẫn phải có trong lựa chọn `company_partners` của bước «Chọn đối tác & người nhận» và gửi được (không PARTNER_NOT_IN_COMPANY).
// Mới mời (chưa đồng ý) ⇒ KHÔNG có. Bằng chứng gốc: bài smoke S12 bản test (A↔B kết nối qua «Tìm công ty» ⇒ «Không có kết quả»).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../kit/adapters/pack-uow";
import { esignRepo } from "./adapters/esign.repo";
import { partnerPrefill } from "./adapters/partner-prefill";
import { partnerSendRepo } from "./adapters/partner-send.repo";

let o: Sql;
let db: Db;
let A = "";
let B = "";
let C = "";
let UA = "";
const TAX_B = "0108888881"; // đã kết nối với A, chưa có HĐ, không có trong sổ đối tác của A
const TAX_C = "0108888882"; // A mới mời, C chưa đồng ý

const uow = () =>
  createPackUow(db, "contracts", (tx, t) => ({
    partnerSend: partnerSendRepo(tx, t),
    esign: esignRepo(tx, t),
  }));

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  [A, B, C] = (await tenants(o, 3, 1390)) as [string, string, string];
  [UA] = (await users(o, A, 1, { from: 1390 })) as [string];
  await o`update admin.tenants set tax_code = ${TAX_B}, legal_name = 'Công ty Kết Nối B' where id = ${B}`;
  await o`update admin.tenants set tax_code = ${TAX_C}, legal_name = 'Công ty Mới Mời C' where id = ${C}`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at) values
    (${A}, ${B}, now(), now()), (${B}, ${A}, now(), now())`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, connect_requested_at) values (${A}, ${C}, now(), now())`;
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("diag-s12 · đối tác đã kết nối có trong «Chọn đối tác»", () => {
  it("lựa chọn `company_partners` có công ty đã kết nối (chưa HĐ); không có công ty mới mời", async () => {
    const p = await partnerPrefill(uow())({ tenantId: A, userId: UA, recordId: "" });
    const opts = p.field_options.partner_tax_code ?? [];
    expect(opts).toContainEqual({ value: TAX_B, label: `Công ty Kết Nối B · ${TAX_B}` });
    expect(opts.map((x) => x.value)).not.toContain(TAX_C);
  });

  it("gửi: MST công ty đã kết nối là đối tác của công ty; công ty mới mời thì không", async () => {
    const isP = (tax: string) => uow().system(A, (r) => r.partnerSend.isPartner(tax));
    expect(await isP(TAX_B)).toBe(true);
    expect(await isP(TAX_C)).toBe(false);
  });
});
