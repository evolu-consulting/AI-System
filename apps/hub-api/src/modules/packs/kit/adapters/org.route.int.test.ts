// CR-139 · Q13 · `GET /pack/contracts/org` (sơ đồ tổ chức, chỉ xem) trên app + DB thật: đường chính (cây + trưởng phòng + thành viên),
// user ngoài (đối tác) ⇒ 403, công ty khác không lộ sang.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  call,
  errorOf,
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

const id = (n: number) => `01900000-0000-7000-8000-0000000d${String(n).padStart(4, "0")}`;
const ORG = id(1);
const EXT_ID = id(2);
const G_ROOT = id(11);
const G_KD = id(12);
const G_BETA = id(13);
type Dept = {
  id: string;
  name: string;
  parent_id: string | null;
  head: { id: string; name: string } | null;
  members: { id: string; name: string }[];
};

let sql: Sql;
let k: Keys;
let hub: HubX;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  await sql`insert into admin.external_orgs (id, tenant_id, name) values (${ORG}, ${T.acme}, 'NCC D')`;
  await sql`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind,
      external_org_id, must_change_password) values
    (${EXT_ID}, ${T.acme}, 'ncc-d', 'x', 'Đối tác D', 'member', 'external', ${ORG}, false)`;
  const [cr] = await sql<
    { id: string }[]
  >`select id from admin.features where key = 'contracts-read'`;
  if (!cr) throw new Error("thiếu feature contracts-read (migration gói)");
  for (const t of [T.acme, T.beta])
    await sql`insert into admin.feature_entitlements (feature_id, tenant_id) values (${cr.id}, ${t})
      on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  const g = async (gid: string, tenant: string, key: string, name: string) =>
    sql`insert into admin.groups (id, tenant_id, key, name) values (${gid}, ${tenant}, ${key}, ${sql.json({ vi: name })})`;
  await g(G_ROOT, T.acme, "d-root", "Ban Giám đốc");
  await g(G_KD, T.acme, "d-kd", "Kinh doanh");
  await g(G_BETA, T.beta, "d-beta", "Phòng công ty khác");
  await sql`insert into admin.departments (tenant_id, group_id, head_user_id, parent_group_id) values
    (${T.acme}, ${G_ROOT}, ${USERS.tadmin.id}, null),
    (${T.acme}, ${G_KD}, ${USERS.lan.id}, ${G_ROOT}),
    (${T.beta}, ${G_BETA}, ${USERS.an.id}, null)`;
  await sql`insert into admin.group_members (tenant_id, group_id, user_id) values
    (${T.acme}, ${G_ROOT}, ${USERS.tadmin.id}), (${T.acme}, ${G_KD}, ${USERS.lan.id}), (${T.acme}, ${G_KD}, ${USERS.hoa.id}),
    (${T.acme}, ${G_KD}, ${USERS.khoa.id}), (${T.beta}, ${G_BETA}, ${USERS.an.id})`;
  // `lan`/`an` đọc được gói qua grant của nhóm mình (nhóm cấp read).
  for (const [t, gid] of [
    [T.acme, G_KD],
    [T.beta, G_BETA],
  ] as const)
    await sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id) values (${t}, ${cr.id}, ${gid}, null)`;
  await sql`insert into contracts.visibility_settings (tenant_id, mode) values (${T.acme}, 'tenant'), (${T.beta}, 'tenant')
    on conflict (tenant_id) do nothing`;
  k = await makeKeys();
  hub = await startHubX(k);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

describe("CR-139 · GET /pack/contracts/org", () => {
  it("đường chính: cây phòng ban + trưởng phòng + thành viên đang dùng được, đúng công ty", async () => {
    const res = await call(hub, "GET", "/pack/contracts/org", { token: await sign(k, USERS.lan) });
    expect(res.status).toBe(200);
    const depts = (res.json as { departments: Dept[] }).departments;
    expect(depts.map((d) => d.id).sort()).toEqual([G_ROOT, G_KD].sort());
    const kd = depts.find((d) => d.id === G_KD);
    expect(kd?.parent_id).toBe(G_ROOT);
    expect(kd?.head?.id).toBe(USERS.lan.id);
    // thành viên bị tenant khoá (`khoa`) không hiện
    expect(kd?.members.map((m) => m.id).sort()).toEqual([USERS.lan.id, USERS.hoa.id].sort());
    expect(depts.find((d) => d.id === G_ROOT)?.parent_id).toBeNull();
  });

  it("user ngoài (đối tác) ⇒ 403; công ty khác không lộ sang nhau", async () => {
    const ext = await sign(
      k,
      { ...USERS.lan, id: EXT_ID, username: "ncc-d" },
      {
        claims: { tid: T.acme, role: "member", sid: null, kind: "external", xorg: ORG },
      },
    );
    const denied = await call(hub, "GET", "/pack/contracts/org", { token: ext });
    expect(denied.status).toBe(403);
    expect(errorOf(denied).code).toBe("FORBIDDEN");
    const beta = await call(hub, "GET", "/pack/contracts/org", { token: await sign(k, USERS.an) });
    expect(beta.status).toBe(200);
    expect((beta.json as { departments: Dept[] }).departments.map((d) => d.id)).toEqual([G_BETA]);
  });
});
