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
  // com-c10b · gói Cộng đồng: `an` (nhóm GRP_CV) được đọc gói `community` → mở dock `community`; `binh` thì không.
  await sql`insert into admin.features (key, name, status) values
    ('community-read', ${sql.json({ vi: "Xem Cộng đồng" })}, 'on') on conflict (key) do nothing`;
  const [cm] = await sql<
    { id: string }[]
  >`select id from admin.features where key = 'community-read'`;
  if (!cm) throw new Error("thiếu feature community-read");
  await sql`insert into admin.feature_entitlements (feature_id, tenant_id) values (${cm.id}, ${T.beta})
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  await sql`insert into admin.feature_grants (tenant_id, feature_id, group_id, user_id) values
    (${T.beta}, ${cm.id}, ${GRP_CV}, null)`;
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

describe("com-c10b · dock trợ lý giá của Cộng đồng (X-Ai-Surface: community)", () => {
  const CDOCK = { "X-Ai-Surface": "community" };
  const create = (token: string, headers = CDOCK) =>
    call(hub, "POST", "/conversations", { token, body: { title: "Giá" }, headers });

  it("chủ quản (nội bộ, đọc gói community) ⇒ 201, hội thoại surface=community; gửi tin chỉ vào đúng dock", async () => {
    const an = await sign(k, USERS.an);
    const c = await create(an);
    expect(c.status).toBe(201);
    const [row] = await sql`select surface from hub.conversations where id = ${c.json.id}`;
    expect(row?.surface).toBe("community");
    const ok = await call(hub, "POST", `/conversations/${c.json.id}/messages`, {
      token: an,
      body: { content: "Giá USB Token?" },
      headers: CDOCK,
    });
    expect(ok.status).not.toBe(403);
    // hội thoại dock contracts không dùng được từ dock community
    const other = await create(an, DOCK);
    const bad = await call(hub, "POST", `/conversations/${other.json.id}/messages`, {
      token: an,
      body: { content: "Giá USB Token?" },
      headers: CDOCK,
    });
    expect(errorOf(bad)).toEqual(DISABLED);
  });

  it("đối tác (kind=external) ⇒ 403, không tạo hội thoại", async () => {
    // Đối tác thật (users.kind=external) (gói community bật cho công ty) — bị chặn (C2: không Chat AI, kể cả dock).
    const ORG = "a7300000-0000-4000-8000-000000000031";
    const EXT = { ...USERS.an, id: "a7300000-0000-4000-8000-000000000032", username: "ncc-c10b" };
    await sql`insert into admin.external_orgs (id, tenant_id, name) values (${ORG}, ${T.beta}, 'NCC C10b')`;
    await sql`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind,
      external_org_id, must_change_password) values (${EXT.id}, ${T.beta}, 'ncc-c10b', 'x', 'NCC', 'member', 'external', ${ORG}, false)`;
    const partner = await sign(k, EXT, {
      claims: { tid: T.beta, role: "member", sid: null, kind: "external", xorg: ORG },
    });
    const before = await sql`select count(*)::int as n from hub.conversations`;
    // C2 chặn đối tác ở cổng ngoài (FORBIDDEN) hoặc chat-gate (CHAT_APP_DISABLED) — cả hai là 403, không tạo gì.
    const res = await create(partner);
    expect(res.status).toBe(403);
    const after = await sql`select count(*)::int as n from hub.conversations`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("nội bộ không có quyền đọc gói community ⇒ 403", async () => {
    expect(errorOf(await create(await sign(k, BINH)))).toEqual(DISABLED);
  });
});

describe("chat-api-gate-fix · dock không là cửa sau của Chat AI", () => {
  const dockConv = async (token: string): Promise<string> => {
    const c = await call(hub, "POST", "/conversations", {
      token,
      body: { title: "Dock" },
      headers: DOCK,
    });
    expect(c.status).toBe(201);
    return c.json.id as string;
  };

  it("hội thoại tạo qua dock được đánh dấu surface=contracts", async () => {
    const id = await dockConv(await sign(k, USERS.an));
    const [row] = await sql`select surface from hub.conversations where id = ${id}`;
    expect(row?.surface).toBe("contracts");
  });

  it("bypass cũ ⇒ 403: @agent, /lệnh, !quy trình, file đính kèm, hội thoại không phải dock", async () => {
    const an = await sign(k, USERS.an);
    const id = await dockConv(an);
    for (const body of [
      { content: "@helper soạn email" },
      { content: "/han-muc-duyet 1 Mua X" },
      { content: "!quy-trinh làm đi" },
      { content: "Xem file", attachment_ids: [UNKNOWN] },
    ]) {
      const res = await call(hub, "POST", `/conversations/${id}/messages`, {
        token: an,
        body,
        headers: DOCK,
      });
      expect({ body, ...errorOf(res) }).toEqual({ body, ...DISABLED });
    }
    // Hội thoại thường (không tạo qua dock) — header dock không mở được.
    const plain = await call(hub, "POST", `/conversations/${R.anConv}/messages`, {
      token: an,
      body: { content: "Xin chào" },
      headers: DOCK,
    });
    expect(errorOf(plain)).toEqual(DISABLED);
  });

  it("văn bản thường vào hội thoại dock ⇒ qua cổng (không 403)", async () => {
    const an = await sign(k, USERS.an);
    const id = await dockConv(an);
    const res = await call(hub, "POST", `/conversations/${id}/messages`, {
      token: an,
      body: { content: "Tóm tắt hợp đồng đang xem" },
      headers: DOCK,
    });
    expect(res.status).not.toBe(403);
    expect(res.status).toBeLessThan(500);
  });
});
