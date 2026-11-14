// CR-102a · com-c2-ext-deny · ma trận user ngoài (đối tác) × bề mặt hub-api trên app + DB thật: tường lửa (mọi gốc route ngoài
// gói `EXTERNAL_SURFACES`), gói `contracts` (packGuard bỏ grant Group), Chat App / chat-gate, agent, danh bạ `/directory`,
// danh bạ người phụ trách `/pack/contracts/members`, RLS `contracts` phòng thủ. Mỗi bề mặt: đường từ chối + nội bộ không đổi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withPackScope } from "@ai/db/pack-scope";
import { sql as dsql } from "drizzle-orm";
import {
  call,
  errorOf,
  HUB_API_URL,
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  sign,
  T,
  UNKNOWN,
  USERS,
} from "../../../../../../../tests/acceptance/H1/_fixtures";
import {
  type HubX,
  insertHubConfig,
  startHubX,
} from "../../../../../../../tests/acceptance/H1/_hub";
import { connectDb, type Db } from "../../../../lib/db";

const ORG = "01900000-0000-7000-8000-0000000c2e01";
const EXT_ID = "01900000-0000-7000-8000-0000000c2e11";
const GRP = "01900000-0000-7000-8000-0000000c2e21";
const EXT = { ...USERS.lan, id: EXT_ID, username: "ncc-c2" };
const FORBIDDEN = { status: 403, code: "FORBIDDEN" };

let sql: Sql;
let k: Keys;
let hub: HubX;
let db: Db;
let extToken: string;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  await sql`insert into admin.external_orgs (id, tenant_id, name) values (${ORG}, ${T.acme}, 'NCC C2')`;
  await sql`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind,
      external_org_id, must_change_password) values
    (${EXT_ID}, ${T.acme}, 'ncc-c2', 'x', 'Đối tác C2', 'member', 'external', ${ORG}, false)`;
  // acme bật Sổ Hợp Tác, nhóm của `lan` được cấp read (đường nội bộ của /members).
  const [cr] = await sql<
    { id: string }[]
  >`select id from admin.features where key = 'contracts-read'`;
  if (!cr) throw new Error("thiếu feature contracts-read (migration gói)");
  await sql`insert into admin.feature_entitlements (feature_id, tenant_id) values (${cr.id}, ${T.acme})
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  await sql`insert into admin.groups (id, tenant_id, key, name) values
    (${GRP}, ${T.acme}, 'c2-viewers', ${sql.json({ vi: "Xem HĐ" })})`;
  await sql`insert into admin.group_members (tenant_id, group_id, user_id) values (${T.acme}, ${GRP}, ${USERS.lan.id})`;
  await sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id) values
    (${T.acme}, ${cr.id}, ${GRP}, null)`;
  await sql`insert into contracts.visibility_settings (tenant_id, mode) values (${T.acme}, 'tenant')
    on conflict (tenant_id) do nothing`;
  k = await makeKeys();
  hub = await startHubX(k);
  db = connectDb(HUB_API_URL, 2);
  const claims = { tid: T.acme, role: "member", sid: null, kind: "external", xorg: ORG };
  extToken = await sign(k, EXT, { claims });
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await db?.close();
  await sql?.end();
});

describe("com-c2 · tường lửa user ngoài (hub-api)", () => {
  it("mọi bề mặt ngoài gói EXTERNAL_SURFACES ⇒ 403 FORBIDDEN, không ghi gì", async () => {
    const before = await sql`select count(*)::int as n from hub.conversations`;
    for (const [m, p, body] of [
      ["GET", "/conversations", undefined], // Chat App
      ["POST", "/conversations", { title: "x" }],
      ["GET", `/conversations/${R.anConv}/messages`, undefined],
      ["GET", `/runs/${UNKNOWN}/events`, undefined],
      ["GET", "/commands", undefined],
      ["GET", "/agents", undefined], // agent (grant tenant / mặc định)
      ["GET", "/agent-grants", undefined],
      ["GET", "/directory", undefined], // danh bạ
      ["GET", "/me/stream", undefined],
      ["GET", "/pack/contracts/me", undefined], // gói không thuộc EXTERNAL_SURFACES
      ["GET", "/pack/contracts/members", undefined],
      ["GET", "/studio/api/agents", undefined],
    ] as const) {
      const res = await call(hub, m, p, { token: extToken, body });
      expect({ p, ...errorOf(res) }).toEqual({ p, ...FORBIDDEN });
    }
    const after = await sql`select count(*)::int as n from hub.conversations`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("chuông thông báo của chính mình vẫn mở; gói community chưa cài ⇒ không phải 403 tường lửa", async () => {
    const n = await call(hub, "GET", "/notifications", { token: extToken });
    expect(n.status).toBe(200);
    const c = await call(hub, "GET", "/pack/community/me", { token: extToken });
    expect(c.status).not.toBe(403);
  });

  it("nội bộ không đổi: Chat, agent, danh bạ, gói contracts", async () => {
    const lan = await sign(k, USERS.lan);
    for (const p of ["/conversations", "/agents", "/directory", "/pack/contracts/me"])
      expect({ p, s: (await call(hub, "GET", p, { token: lan })).status }).toEqual({ p, s: 200 });
  });
});

describe("com-c2 · danh bạ + người phụ trách không lộ đối tác cho nhân viên", () => {
  it("/directory của nhân viên không có user ngoài", async () => {
    const res = await call(hub, "GET", "/directory?q=ncc", { token: await sign(k, USERS.lan) });
    expect(res.status).toBe(200);
    expect((res.json.items as { id: string }[]).map((x) => x.id)).not.toContain(EXT_ID);
  });

  it("/pack/contracts/members của nhân viên không có user ngoài", async () => {
    const res = await call(hub, "GET", "/pack/contracts/members", {
      token: await sign(k, USERS.lan),
    });
    expect(res.status).toBe(200);
    const ids = (res.json.items as { id: string }[]).map((x) => x.id);
    expect(ids).toContain(USERS.lan.id);
    expect(ids).not.toContain(EXT_ID);
  });
});

describe("CR-151 · /pack/contracts/members trang + tìm ở máy chủ", () => {
  const get = async (qs: string) =>
    call(hub, "GET", `/pack/contracts/members${qs}`, { token: await sign(k, USERS.lan) });
  const items = (r: { json: Record<string, unknown> }) =>
    r.json.items as { id: string; name: string }[];

  it("trang 1 + trang 2 không trùng, next_offset đúng, hết trang thì null, không limit thì không có next_offset", async () => {
    const a = await get("?limit=2&offset=0");
    const b = await get("?limit=2&offset=2");
    expect(items(a)).toHaveLength(2);
    expect(a.json.next_offset).toBe(2);
    expect(items(b).length).toBeGreaterThan(0);
    expect(
      items(b)
        .map((x) => x.id)
        .filter((id) => items(a).some((y) => y.id === id)),
    ).toEqual([]);
    const last = await get("?limit=50&offset=0");
    expect(last.json.next_offset).toBeNull();
    const full = await get("");
    expect(full.json.next_offset).toBeUndefined();
  });

  it("tìm theo tên + chéo tenant (user tenant beta không bao giờ có) + trần limit 50", async () => {
    const hit = await get("?limit=50&q=lan");
    expect(items(hit).map((x) => x.id)).toEqual([USERS.lan.id]);
    const all = await get("?limit=50");
    expect(items(all).map((x) => x.id)).not.toContain(USERS.an.id);
    const over = await get("?limit=51");
    expect(over.status).toBe(400);
  });
});

describe("com-c2 · RLS phòng thủ gói contracts (0067 ext_deny)", () => {
  const count = (userId: string) =>
    withPackScope(db, { packKey: "contracts", tenantId: T.acme, userId }, async (tx) => {
      const r = (await tx.execute(
        dsql`select count(*)::int as n from contracts.visibility_settings`,
      )) as unknown as { n: number }[];
      return r[0]?.n ?? -1;
    });

  it("đối tác ⇒ 0 hàng và không ghi được; nhân viên / việc nền thấy như cũ", async () => {
    expect(await count(EXT_ID)).toBe(0);
    expect(await count(USERS.lan.id)).toBe(1);
    const upd = await withPackScope(
      db,
      { packKey: "contracts", tenantId: T.acme, userId: EXT_ID },
      (tx) =>
        tx.execute(dsql`update contracts.visibility_settings set mode = 'org' returning tenant_id`),
    );
    expect((upd as unknown as unknown[]).length).toBe(0);
    const bg = await withPackScope(
      db,
      { packKey: "contracts", tenantId: T.acme, userId: null },
      (tx) => tx.execute(dsql`select mode from contracts.visibility_settings`),
    );
    expect((bg as unknown as { mode: string }[])[0]?.mode).toBe("tenant");
  });
});
