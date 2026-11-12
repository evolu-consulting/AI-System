// CR-127 · Z0 · D7: công ty MỚI (có tên trong `keys`) nhận nhóm «Người ký HĐ» (mẫu Sổ Hợp Tác không còn seed); công ty ngoài `keys` KHÔNG bị gán.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { writeCr125Config } from "./seed.cr125-config";
import { SIGNER_GROUP_KEY } from "./seed.cr127-config";

const NEW_T = "00000000-0000-4000-8000-000000012701";
const OLD_T = "00000000-0000-4000-8000-000000012702";
const NEW_K = "t12701";
const OLD_K = "t12702";
let o: Sql;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  for (const [id, k] of [
    [NEW_T, NEW_K],
    [OLD_T, OLD_K],
  ] as const) {
    await o`insert into admin.tenants (id, key, name) values (${id}, ${k}, ${k})`;
    await o`insert into admin.feature_entitlements (feature_id, tenant_id, granted_by)
      select f.id, ${id}, null from admin.features f where f.key = 'contracts-read' on conflict do nothing`;
  }
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});

const flowIds = (t: string) =>
  o<{ flow_id: string; position: number }[]>`select flow_id, position from hub.company_flows
    where tenant_id = ${t} and enabled order by position, flow_id`;

describe("CR-127 · Z0 · seed công ty mới", () => {
  it("công ty mới: không có flow Hợp đồng sẵn, nhóm Người ký HĐ được chọn; chạy lại không nhân đôi", async () => {
    const r1 = await o.begin((tx) => writeCr125Config(tx as never, [NEW_K]));
    expect(r1.partnerSigners).toBe(1);
    // CR-127 Z9: seed KHÔNG gán flow nào cho công ty (quản trị nền tảng tạo quy trình riêng từ sơ đồ trống).
    const rows = await flowIds(NEW_T);
    expect(rows.length).toBe(0);
    const [s] =
      await o`select g.key from contracts.partner_settings p join admin.groups g on g.id = p.signer_group_id
      where p.tenant_id = ${NEW_T}`;
    expect(s?.key).toBe(SIGNER_GROUP_KEY);
    const r2 = await o.begin((tx) => writeCr125Config(tx as never, [NEW_K]));
    expect(r2.partnerSigners).toBe(0);
    expect((await flowIds(NEW_T)).length).toBe(0);
  });

  it("công ty đang có (ngoài danh sách keys) không bị gán mẫu hay nhóm người ký", async () => {
    expect((await flowIds(OLD_T)).length).toBe(0);
    const ps = await o`select 1 from contracts.partner_settings where tenant_id = ${OLD_T}`;
    expect(ps.length).toBe(0);
    const g =
      await o`select 1 from admin.groups where tenant_id = ${OLD_T} and key = ${SIGNER_GROUP_KEY}`;
    expect(g.length).toBe(0);
  });
});
