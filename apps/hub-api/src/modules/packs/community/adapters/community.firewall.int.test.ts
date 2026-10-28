// CR-102 · com-c3 × com-c2: app hub-api thật (requireAuth + `externalFirewall` + `EXTERNAL_PACKS`): đối tác vào được
// `/pack/community/*` (gói đã cài + bật cho tenant) nhưng vẫn 403 ở bề mặt khác; nội bộ vào community theo Group.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  call,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  T,
  USERS,
} from "../../../../../../../tests/acceptance/H1/_fixtures";
import {
  type HubX,
  insertHubConfig,
  startHubX,
} from "../../../../../../../tests/acceptance/H1/_hub";

const ORG = "01900000-0000-7000-8000-0000000c3e01";
const EXT_ID = "01900000-0000-7000-8000-0000000c3e11";
const GRP = "01900000-0000-7000-8000-0000000c3e21";
const EXT = { ...USERS.lan, id: EXT_ID, username: "ncc-c3" };

let sql: Sql;
let k: Keys;
let hub: HubX;
let extToken: string;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  await sql`insert into admin.external_orgs (id, tenant_id, name) values (${ORG}, ${T.acme}, 'NCC C3')`;
  await sql`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind,
      external_org_id, must_change_password) values
    (${EXT_ID}, ${T.acme}, 'ncc-c3', 'x', 'Đối tác C3', 'member', 'external', ${ORG}, false)`;
  await sql`insert into admin.feature_entitlements (feature_id, tenant_id)
    select f.id, ${T.acme}::uuid from admin.features f where f.key in ('community-read', 'community-write', 'community-admin')
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  await sql`insert into admin.groups (id, tenant_id, key, name) values (${GRP}, ${T.acme}, 'c3-community', ${sql.json({ vi: "Cộng đồng" })})`;
  await sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${T.acme}, ${GRP}, ${USERS.lan.id})`;
  await sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id)
    select ${T.acme}::uuid, f.id, ${GRP}::uuid, null from admin.features f where f.key in ('community-read', 'community-write')`;
  await sql`insert into community.partner_companies (tenant_id, ext_org_id, labels, cats)
    values (${T.acme}, ${ORG}, '{supplier}', '{dong-goi}')`;
  k = await makeKeys();
  hub = await startHubX(k);
  extToken = await sign(k, EXT, {
    claims: { tid: T.acme, role: "member", sid: null, kind: "external", xorg: ORG },
  });
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

describe("com-c3 · tường lửa đối tác", () => {
  it("đối tác: /pack/community/viewer + đăng bài Cần bán 200/201; /pack/contracts/me, /directory 403", async () => {
    const v = await call(hub, "GET", "/pack/community/viewer", { token: extToken });
    expect({ s: v.status, role: v.json?.role, org: v.json?.orgId }).toEqual({
      s: 200,
      role: "partner",
      org: ORG,
    });
    const p = await call(hub, "POST", "/pack/community/posts", {
      token: extToken,
      body: { type: "sell", fields: { product: "Băng keo", qty: "10", price: null } },
    });
    expect(p.status).toBe(201);
    for (const path of ["/pack/contracts/me", "/directory"])
      expect({ path, s: (await call(hub, "GET", path, { token: extToken })).status }).toEqual({
        path,
        s: 403,
      });
  });
  it("nội bộ (Group được cấp community) thấy bài đối tác với vai chủ quản", async () => {
    const lan = await sign(k, USERS.lan);
    const f = await call(hub, "GET", "/pack/community/feed", { token: lan });
    expect({ s: f.status, n: f.json?.items?.length, side: f.json?.items?.[0]?.authorSide }).toEqual(
      {
        s: 200,
        n: 1,
        side: "partner",
      },
    );
  });
});
