// chat-api-gate · int: công ty bị thu hồi `chat-app` ⇒ 403 `CHAT_APP_DISABLED` trên route chat chính; công ty có quyền ⇒ như cũ;
// route gói Sổ Hợp Tác + dock trợ lý (`X-Ai-Surface: contracts`, user có quyền đọc gói) vẫn chạy cho công ty bị thu hồi.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  call,
  errorOf,
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
} from "../../../../../tests/acceptance/H1/_fixtures";
import { type HubX, insertHubConfig, startHubX } from "../../../../../tests/acceptance/H1/_hub";

let sql: Sql;
let k: Keys;
let hub: HubX;
const F = { chat: "a7300000-0000-4000-8000-000000000001", cread: "" };
const GRP_CV = "a7300000-0000-4000-8000-000000000011";
const DOCK = { "X-Ai-Surface": "contracts" };
const DISABLED = { status: 403, code: "CHAT_APP_DISABLED" };
/** User thứ hai của `beta`, KHÔNG thuộc nhóm Sổ Hợp Tác. */
const BINH = { ...USERS.an, id: "a7300000-0000-4000-8000-000000000021", username: "binh" };

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  // Feature `chat-app` tạo sau tenant ⇒ trigger 0024 cấp mọi tenant; thu hồi riêng `beta` (như Features › Thu hồi).
  await sql`insert into admin.features (id, key, name, status) values
    (${F.chat}, 'chat-app', ${sql.json({ vi: "Chat AI" })}, 'on')`;
  await sql`update admin.feature_entitlements set revoked_at = now()
    where feature_id = ${F.chat} and tenant_id = ${T.beta}`;
  // `beta` có gói Sổ Hợp Tác (feature `contracts-read` do migration gói tạo): entitlement + nhóm của `an` được cấp.
  const [cr] = await sql<
    { id: string }[]
  >`select id from admin.features where key = 'contracts-read'`;
  if (!cr) throw new Error("thiếu feature contracts-read (migration gói)");
  F.cread = cr.id;
  await sql`insert into admin.feature_entitlements (feature_id, tenant_id) values (${F.cread}, ${T.beta})
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  await sql`insert into admin.users (id, tenant_id, username, email, password_hash, display_name, role, locale,
      active, locked_by_tenant, must_change_password) values (${BINH.id}, ${T.beta}, 'binh', 'binh@example.test', 'x',
      'binh', 'member', 'vi', true, false, false)`;
  await sql`insert into admin.groups (id, tenant_id, key, name) values
    (${GRP_CV}, ${T.beta}, 'contracts-viewer', ${sql.json({ vi: "Xem HĐ" })})`;
  await sql`insert into admin.group_members (tenant_id, group_id, user_id) values
    (${T.beta}, ${GRP_CV}, ${USERS.an.id})`;
  await sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id) values
    (${T.beta}, ${F.cread}, ${GRP_CV}, null)`;
  k = await makeKeys();
  hub = await startHubX(k);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

describe("chat-api-gate · chặn API Chat AI theo entitlement công ty", () => {
  it("công ty bị thu hồi ⇒ 403 CHAT_APP_DISABLED trên route chat chính (kể cả tenant_admin), không ghi gì", async () => {
    const an = await sign(k, USERS.an);
    const before = await sql`select count(*)::int as n from hub.conversations`;
    for (const [m, p, body] of [
      ["GET", "/conversations", undefined],
      ["POST", "/conversations", { title: "x" }],
      ["GET", `/conversations/${R.anConv}/messages`, undefined],
      ["POST", `/conversations/${R.anConv}/messages`, { content: "Xin chào" }],
      ["GET", `/runs/${UNKNOWN}/events`, undefined],
      ["POST", `/runs/${UNKNOWN}/cancel`, undefined],
      ["GET", "/commands", undefined],
      ["GET", "/agents", undefined],
      ["GET", "/directory", undefined],
      ["GET", "/me/stream", undefined],
      ["GET", `/attachments/${UNKNOWN}/content`, undefined],
    ] as const) {
      const res = await call(hub, m, p, { token: an, body });
      expect({ p, ...errorOf(res) }).toEqual({ p, ...DISABLED });
    }
    const after = await sql`select count(*)::int as n from hub.conversations`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("công ty còn quyền ⇒ như cũ", async () => {
    const lan = await sign(k, USERS.lan);
    expect((await call(hub, "GET", "/conversations", { token: lan })).status).toBe(200);
    expect((await call(hub, "GET", "/agents", { token: lan })).status).toBe(200);
    expect((await call(hub, "GET", "/commands", { token: lan })).status).toBe(200);
    const c = await call(hub, "POST", "/conversations", { token: lan, body: { title: "Mới" } });
    expect(c.status).toBe(201);
  });

  it("công ty bị thu hồi: gói Sổ Hợp Tác + dock trợ lý (X-Ai-Surface: contracts) vẫn chạy", async () => {
    const an = await sign(k, USERS.an);
    const me = await call(hub, "GET", "/pack/contracts/me", { token: an });
    expect(me.status).toBe(200);
    expect(me.json?.enabled).toBe(true);
    const c = await call(hub, "POST", "/conversations", {
      token: an,
      body: { title: "Hỏi HĐ" },
      headers: DOCK,
    });
    expect(c.status).toBe(201);
    // Qua cổng ⇒ tới route thật (404 hội thoại/run không có), không phải 403.
    const send = await call(hub, "POST", `/conversations/${UNKNOWN}/messages`, {
      token: an,
      body: { content: "Tóm tắt HĐ" },
      headers: DOCK,
    });
    expect(errorOf(send)).toEqual({ status: 404, code: "NOT_FOUND" });
    const cancel = await call(hub, "POST", `/runs/${UNKNOWN}/cancel`, { token: an, headers: DOCK });
    expect(cancel.status).toBe(404);
    // Header dock KHÔNG mở route chat khác.
    const list = await call(hub, "GET", "/conversations", { token: an, headers: DOCK });
    expect(errorOf(list)).toEqual(DISABLED);
  });

  it("header dock không mở được cho user ngoài nhóm Sổ Hợp Tác (dù tenant có gói)", async () => {
    const binh = await sign(k, BINH);
    const res = await call(hub, "POST", "/conversations", {
      token: binh,
      body: { title: "x" },
      headers: DOCK,
    });
    expect(errorOf(res)).toEqual(DISABLED);
  });

  it("platform_admin không bị chặn", async () => {
    const res = await call(hub, "GET", "/conversations", { token: await sign(k, USERS.padmin) });
    expect(res.status).toBe(200);
  });
});
