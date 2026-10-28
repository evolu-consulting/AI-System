// CR-102a · ADM-FR-74 · `pgExternalOrgResolver` trên DB thật qua role hub (hub_ro đọc admin.users/external_orgs):
// identity theo tập trong MỘT tenant; user/org của tenant khác KHÔNG lộ (chặn đọc chéo tenant của bảng mới).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  HUB_API_URL,
  insertFixture,
  ownerSql,
  prepareDb,
  type Sql,
  T,
  USERS,
} from "../../../../../../../tests/acceptance/H1/_fixtures";
import { connectDb, type Db } from "../../../../lib/db";
import { pgExternalOrgResolver } from "./ext-org.pg";

const ORG = "01900000-0000-7000-8000-0000000c1e01";
const ORG_BETA = "01900000-0000-7000-8000-0000000c1e02";
const EXT = "01900000-0000-7000-8000-0000000c1e11";
const EXT_BETA = "01900000-0000-7000-8000-0000000c1e12";

let sql: Sql;
let db: Db;
beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await sql`insert into admin.external_orgs (id, tenant_id, name) values
    (${ORG}, ${T.acme}, 'NCC Một'), (${ORG_BETA}, ${T.beta}, 'NCC Beta')`;
  await sql`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind, external_org_id) values
    (${EXT}, ${T.acme}, 'ncc1', 'x', 'NCC 1', 'member', 'external', ${ORG}),
    (${EXT_BETA}, ${T.beta}, 'nccb', 'x', 'NCC B', 'member', 'external', ${ORG_BETA})`;
  db = connectDb(HUB_API_URL, 2);
}, 60_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});

describe("CR-102a · ExternalOrgResolver (Postgres)", () => {
  it("identities: nội bộ / đối tác trong tenant; user tenant khác, id lạ, id hỏng ⇒ vắng", async () => {
    const r = pgExternalOrgResolver(db);
    const m = await r.identities(T.acme, [USERS.lan.id, EXT, EXT_BETA, USERS.an.id, "not-a-uuid"]);
    expect(Object.fromEntries(m)).toEqual({
      [USERS.lan.id]: { kind: "internal", extOrgId: null },
      [EXT]: { kind: "external", extOrgId: ORG },
    });
    expect((await r.identities(T.acme, [])).size).toBe(0);
  });

  it("orgNames: chỉ công ty của tenant hỏi (chặn đọc chéo tenant)", async () => {
    const r = pgExternalOrgResolver(db);
    const m = await r.orgNames(T.acme, [ORG, ORG_BETA]);
    expect(Object.fromEntries(m)).toEqual({ [ORG]: { name: "NCC Một", active: true } });
  });
});
