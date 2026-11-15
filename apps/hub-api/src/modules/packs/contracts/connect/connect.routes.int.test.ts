// CR-161 · lát 5 · spec §2 R1–R7, R10 · §3 · §5: route `/pack/contracts/connect/**` thật (Hono + pool `hub_api` + role `contracts_rw` + RLS).
// R1: nhân viên (Vy, có read+write, KHÔNG có admin) ⇒ 403 `PACK_FORBIDDEN` cho MỌI route, 0 dòng đổi. N2: Dung (Toàn quyền B, không phải người
// tạo dữ liệu nào) đồng ý được. Mã lỗi: 422 CONNECT_NOT_LISTED, 409 CONNECT_DECLINED / CONNECT_NOT_CONNECTED, 404 không lộ (42501), 400.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  CcPostsResponseSchema,
  ConnectInviteResponseSchema,
  ConnectListResponseSchema,
  ConnectSearchResponseSchema,
} from "@ai/contracts/pack-contracts";
import { createDb, type Db, type Tx } from "@ai/db";
import { enableAddon, enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/public";
import { createPackUow, packTenantOnly } from "../../kit/public";
import { partnerModule } from "../partner-routes.mount";
import { connectRepo } from "./adapters/connect.repo";

const A = tenantId(1630); // NitiGroup
const B = tenantId(1631); // Preschool (có Bảng tin)
const C = tenantId(1632); // công ty thứ ba
const E = tenantId(1633); // không bật Danh bạ
const G = tenantId(1634); // chặn A TRƯỚC khi A từng mời
const TIEN = userId(1630); // A · Toàn quyền
const VY = userId(1631); // A · nhân viên (read+write)
const DUNG = userId(1632); // B · Toàn quyền
const CUONG = userId(1633); // C · Toàn quyền
const POSTER = userId(1634); // B · người đăng bài
const F = { read: "f-r", write: "f-w", admin: "f-a" };
let o: Sql;
let db: Db;
let who: Map<string, { tenant: string; group: string }>;
let grp: Map<string, Record<"owner" | "editor" | "viewer", string>>;

function view(): PackAccessView {
  const all = [A, B, C, E, G];
  return {
    catalog: async () => ({
      features: [
        { id: F.read, key: "contracts-read", status: "on" },
        { id: F.write, key: "contracts-write", status: "on" },
        { id: F.admin, key: "contracts-admin", status: "on" },
      ],
      entitled: new Set(all.flatMap((t) => Object.values(F).map((f) => `${t}:${f}`))),
      grantGroups: new Map(
        all.flatMap((t) => {
          const g = grp.get(t);
          if (!g) return [];
          return [
            [`${t}:${F.read}`, [g.owner, g.editor, g.viewer]],
            [`${t}:${F.write}`, [g.owner, g.editor]],
            [`${t}:${F.admin}`, [g.owner]],
          ] as [string, string[]][];
        }),
      ),
    }),
    user: async (id) => {
      const w = who.get(id);
      return w ? { tenantId: w.tenant, groupIds: new Set([w.group]) } : undefined;
    },
  };
}
function app(user: string) {
  const w = who.get(user);
  const h = new Hono<PackGuardVars>();
  h.use("*", async (c, next) => {
    c.set("user", { userId: user, tenantId: w?.tenant, role: "member" } as never);
    await next();
  });
  h.route("/", partnerModule(db, view()));
  h.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return h;
}
type Res<T = unknown> = { status: number; body: T };
const call = async <T = unknown>(
  user: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Res<T>> => {
  const r = await app(user).request(path, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  return { status: r.status, body: (await r.json()) as T };
};
const code = (r: Res) => (r.body as { error?: { code?: string } }).error?.code;
const nLinks = () =>
  o`select count(*)::int as n from hub.partner_links`.then((r) => r[0]?.n as number);
const bells = (tenant: string, kind: string) =>
  o<{ user_id: string; link: string; fanout_at: Date | null }[]>`select user_id, link, fanout_at
    from hub.notifications where tenant_id = ${tenant} and kind = ${kind} order by seq`;
type Item = {
  tenant_id: string;
  status: string;
  note: string | null;
  invited_by_name: string | null;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'cr-a', 'A', 'NitiGroup', '0100000201', true), (${B}, 'cr-b', 'B', 'Preschool Việt', '0100000202', true),
           (${C}, 'cr-c', 'C', 'Công ty Cờ', '0100000203', true), (${E}, 'cr-e', 'E', 'Công ty Ê', '0100000204', false),
           (${G}, 'cr-g', 'G', 'Công ty Gờ', '0100000205', true)`;
  await users(o, A, 2, { from: 1630 });
  await users(o, B, 1, { from: 1632 });
  await users(o, C, 1, { from: 1633 });
  await users(o, B, 1, { from: 1634 });
  grp = await enablePack(o, [A, B, C, E, G], "contracts");
  const g = (t: string) => grp.get(t) as Record<"owner" | "editor" | "viewer", string>;
  await members(o, A, g(A).owner, [TIEN]);
  await members(o, A, g(A).editor, [VY]);
  await members(o, B, g(B).owner, [DUNG]);
  await members(o, B, g(B).editor, [POSTER]);
  await members(o, C, g(C).owner, [CUONG]);
  who = new Map([
    [TIEN, { tenant: A, group: g(A).owner }],
    [VY, { tenant: A, group: g(A).editor }],
    [DUNG, { tenant: B, group: g(B).owner }],
    [POSTER, { tenant: B, group: g(B).editor }],
    [CUONG, { tenant: C, group: g(C).owner }],
  ]);
  await enableAddon(o, [B], "contracts-community");
  // G chặn A trước khi A từng mời: dòng (A→G) có blocked_at, KHÔNG có requested_at.
  await o`insert into hub.partner_links (from_tenant, to_tenant, blocked_at) values (${A}, ${G}, now())`;
  const post = (key: string, aud: string, ageDays: number) => o`insert into community.posts
    (tenant_id, type, author_user_id, author_name, author_org, status, hidden, title_raw, title_masked, body_raw, body_masked,
     fields_raw, fields_masked, hits, cats, aud_mode, created_at, expires_at)
    values (${B}, 'sell', ${POSTER}, 'Người đăng', null, 'active', false, ${`RAW-${key}`}, ${key}, ${`SĐT 0912345678 ${key}`},
      ${`SĐT *** ${key}`}, ${o.json({ phone: "0912345678" })}, ${o.json({ phone: "***" })}, ${o.json([{ rule: "phone" }])},
      ${o.array(["dong-goi"])}, ${aud}, now() - ${ageDays} * interval '1 day', now() + interval '30 days')`;
  await post("bai_moi", "all", 0);
  await post("bai_cu", "all", 2);
  await post("bai_rieng", "suppliers", 0);
  db = createDb(urls().hubApi, { max: 4 });
}, 90_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const ROUTES: [string, string, unknown?][] = [
  ["GET", "/connect/search?q=Preschool"],
  ["POST", "/connect/invites", { tenant_id: B }],
  ["GET", "/connect/links"],
  ["POST", `/connect/links/${B}/accept`],
  ["POST", `/connect/links/${B}/decline`],
  ["DELETE", `/connect/links/${B}`],
];

describe("CR-161 · R1 cổng Toàn quyền ở route", () => {
  it("nhân viên (Vy) gọi MỌI route (mời, đồng ý, từ chối, ngắt, tìm, danh sách) ⇒ 403 PACK_FORBIDDEN, không đổi dòng nào", async () => {
    const before = await nLinks();
    for (const [m, p, b] of ROUTES) {
      const r = await call(VY, m, p, b);
      expect([m, p, r.status, code(r)]).toEqual([m, p, 403, "PACK_FORBIDDEN"]);
    }
    expect(await nLinks()).toBe(before);
    expect(await bells(B, "cc.invite")).toHaveLength(0);
  });
  it("người dùng không thuộc công ty nào (không có nhóm) ⇒ 403", async () => {
    const r = await call(userId(1699), "GET", "/connect/links");
    expect(r.status).toBe(403);
  });
});

describe("CR-161 · R2 tìm + R3 mời + R4 đồng ý + danh sách (hai vai khác nhau)", () => {
  it("tìm Preschool ⇒ none; mời kèm lời nhắn ⇒ pending_out (idempotent); Dung thấy pending_in + lời nhắn + chuông không email", async () => {
    const s = await call<{ items: { tenant_id: string; status: string }[] }>(
      TIEN,
      "GET",
      "/connect/search?q=Preschool",
    );
    expect(s.status).toBe(200);
    expect(ConnectSearchResponseSchema.safeParse(s.body).success).toBe(true);
    expect(s.body.items.map((x) => [x.tenant_id, x.status])).toEqual([[B, "none"]]);
    expect((await call(TIEN, "GET", "/connect/search?q=ab")).status).toBe(400); // chưa đủ ký tự
    expect((await call(TIEN, "GET", "/connect/search?q=Preschool&x=1")).status).toBe(400); // khoá lạ (strict)

    const inv = await call(TIEN, "POST", "/connect/invites", {
      tenant_id: B,
      note: "  Chào Preschool  ",
    });
    expect([inv.status, inv.body]).toEqual([200, { status: "pending_out" }]);
    expect(ConnectInviteResponseSchema.safeParse(inv.body).success).toBe(true);
    const again = await call(TIEN, "POST", "/connect/invites", { tenant_id: B });
    expect(again.body).toEqual({ status: "pending_out" });
    expect(await bells(B, "cc.invite")).toHaveLength(1); // lời mời lặp không thêm chuông

    const mineOut = await call<{ items: Item[]; next_cursor: string | null }>(
      TIEN,
      "GET",
      "/connect/links?status=pending_out",
    );
    expect(ConnectListResponseSchema.safeParse(mineOut.body).success).toBe(true);
    expect(mineOut.body.items.map((x) => x.tenant_id)).toEqual([B]);
    const theirs = await call<{ items: Item[] }>(DUNG, "GET", "/connect/links?status=pending_in");
    expect(theirs.body.items).toHaveLength(1);
    expect(theirs.body.items[0]).toMatchObject({
      tenant_id: A,
      status: "pending_in",
      note: "Chào Preschool",
      invited_by_name: "User 1630",
    });
    const bell = (await bells(B, "cc.invite"))[0];
    expect(bell?.user_id).toBe(DUNG);
    expect(bell?.link.startsWith("/contracts/")).toBe(true);
    expect(bell?.fanout_at).not.toBeNull(); // đã «chia kênh» ⇒ không email/push (R9)
  });

  it("danh sách: limit + con trỏ; cursor sai ⇒ 400; status sai ⇒ 400", async () => {
    expect((await call(TIEN, "GET", "/connect/links?cursor=!!!")).status).toBe(400);
    expect((await call(TIEN, "GET", "/connect/links?status=declined")).status).toBe(400);
    expect((await call(TIEN, "GET", "/connect/links?limit=0")).status).toBe(400);
    expect((await call(TIEN, "GET", "/connect/links?limit=51")).status).toBe(400);
  });

  it("N2: Dung (Toàn quyền B, không phải người tạo dữ liệu) đồng ý ⇒ cả hai thấy connected; chuông «đã đồng ý» cho Tiên", async () => {
    const ok = await call(DUNG, "POST", `/connect/links/${A}/accept`);
    expect([ok.status, ok.body]).toEqual([200, { ok: true }]);
    for (const [u, other] of [
      [TIEN, B],
      [DUNG, A],
    ] as const) {
      const l = await call<{ items: Item[] }>(u, "GET", "/connect/links?status=connected");
      expect(l.body.items.map((x) => [x.tenant_id, x.status])).toEqual([[other, "connected"]]);
    }
    const b = await bells(A, "cc.accepted");
    expect(b.map((x) => x.user_id)).toEqual([TIEN]);
    expect(b[0]?.link.startsWith("/contracts/")).toBe(true);
    // Đồng ý lần hai vẫn 200 (idempotent), không chuông lặp.
    expect((await call(DUNG, "POST", `/connect/links/${A}/accept`)).status).toBe(200);
    expect(await bells(A, "cc.accepted")).toHaveLength(1);
    // Đã connected: mời lại ⇒ connected, không đổi gì.
    const n = await nLinks();
    expect((await call(TIEN, "POST", "/connect/invites", { tenant_id: B })).body).toEqual({
      status: "connected",
    });
    expect(await nLinks()).toBe(n);
  });
});

describe("CR-161 · R3/R5 mã lỗi, không lộ", () => {
  it("không bật Danh bạ ⇒ 422 CONNECT_NOT_LISTED; tự mời ⇒ 400; thân sai ⇒ 400", async () => {
    const e = await call(TIEN, "POST", "/connect/invites", { tenant_id: E });
    expect([e.status, code(e)]).toEqual([422, "CONNECT_NOT_LISTED"]);
    expect((await call(TIEN, "POST", "/connect/invites", { tenant_id: A })).status).toBe(400);
    expect((await call(TIEN, "POST", "/connect/invites", { tenant_id: "x" })).status).toBe(400);
    expect(
      (await call(TIEN, "POST", "/connect/invites", { tenant_id: C, note: "x".repeat(501) }))
        .status,
    ).toBe(400);
    expect((await call(TIEN, "POST", "/connect/invites", { tenant_id: C, extra: 1 })).status).toBe(
      400,
    );
  });
  it("C từ chối ⇒ A gửi lại ⇒ 409 CONNECT_DECLINED; A thấy declined khi tìm; không chuông cho A (Q3)", async () => {
    expect((await call(TIEN, "POST", "/connect/invites", { tenant_id: C })).body).toEqual({
      status: "pending_out",
    });
    const d = await call(CUONG, "POST", `/connect/links/${A}/decline`);
    expect([d.status, d.body]).toEqual([200, { ok: true }]);
    const re = await call(TIEN, "POST", "/connect/invites", { tenant_id: C });
    expect([re.status, code(re)]).toEqual([409, "CONNECT_DECLINED"]);
    const s = await call<{ items: { status: string }[] }>(
      TIEN,
      "GET",
      "/connect/search?q=C%C3%B4ng%20ty%20C",
    );
    expect(s.body.items.map((x) => x.status)).toEqual(["declined"]);
    expect(await bells(A, "cc.declined")).toHaveLength(0);
  });
  it("đồng ý/từ chối lời mời không tồn tại hoặc của công ty thứ ba ⇒ 404 (42501, không lộ); id sai ⇒ 400", async () => {
    expect((await call(CUONG, "POST", `/connect/links/${B}/accept`)).status).toBe(404);
    expect((await call(DUNG, "POST", `/connect/links/${C}/accept`)).status).toBe(404);
    expect((await call(DUNG, "POST", "/connect/links/xyz/accept")).status).toBe(400);
  });
  it("chặn-trước: G đã chặn A, A mời ⇒ trả pending_out im lặng, KHÔNG ghi gì; A không thấy «đang chờ» khi tải lại, G không thấy lời mời", async () => {
    const n = await nLinks();
    const r = await call(TIEN, "POST", "/connect/invites", { tenant_id: G });
    expect([r.status, r.body]).toEqual([200, { status: "pending_out" }]);
    expect(await nLinks()).toBe(n);
    const [row] =
      await o`select requested_at, connect_requested_at from hub.partner_links where from_tenant = ${A} and to_tenant = ${G}`;
    expect([row?.requested_at, row?.connect_requested_at]).toEqual([null, null]);
    const mine = await call<{ items: Item[] }>(TIEN, "GET", "/connect/links");
    expect(mine.body.items.map((x) => x.tenant_id)).not.toContain(G);
    expect(await bells(G, "cc.invite")).toHaveLength(0);
  });
});

describe("CR-161 · R10 bài công khai của công ty đã kết nối", () => {
  it("A xem bài B (đã che, chỉ bài công khai), phân trang bằng con trỏ; công ty thứ ba / không phải Toàn quyền ⇒ không xem được", async () => {
    const p1 = await call<{
      items: { title: string; body: string; fields: Record<string, unknown>; file_count: number }[];
      next_cursor: string | null;
    }>(TIEN, "GET", `/connect/posts/${B}?limit=1`);
    expect(p1.status).toBe(200);
    expect(CcPostsResponseSchema.safeParse(p1.body).success).toBe(true);
    expect(p1.body.items.map((x) => x.title)).toEqual(["bai_moi"]);
    expect(p1.body.items[0]?.body).toBe("SĐT *** bai_moi"); // bản đã che, không lộ số thật
    expect(p1.body.items[0]?.fields).toEqual({ phone: "***" });
    expect(JSON.stringify(p1.body)).not.toContain("0912345678");
    expect(p1.body.next_cursor).not.toBeNull();
    const p2 = await call<{ items: { title: string }[]; next_cursor: string | null }>(
      TIEN,
      "GET",
      `/connect/posts/${B}?limit=1&cursor=${p1.body.next_cursor}`,
    );
    expect(p2.body.items.map((x) => x.title)).toEqual(["bai_cu"]);
    expect(p2.body.next_cursor).toBeNull(); // bài `suppliers` không công khai ⇒ không có
    expect((await call(TIEN, "GET", `/connect/posts/${B}?cursor=@@`)).status).toBe(400);
    const c = await call(CUONG, "GET", `/connect/posts/${B}`);
    expect([c.status, code(c)]).toEqual([404, "CONNECT_NOT_CONNECTED"]);
    expect((await call(VY, "GET", `/connect/posts/${B}?limit=1`)).status).toBe(200); // CR-169: guard `read` — Vy (nhân viên, không Toàn quyền, không phải người mời) xem được
    expect((await call(DUNG, "GET", `/connect/posts/${B}`)).status).toBe(400); // chính công ty mình: không đi đường này (22023)
  });
});

describe("CR-161 · cc_notify: chỉ link /contracts + lô ::text::jsonb", () => {
  it("link ngoài /contracts ⇒ từ chối trước khi chạm DB; link hợp lệ ⇒ 1 chuông, lặp cùng dedup ⇒ 0", async () => {
    const uow = packTenantOnly(
      createPackUow(db, "contracts", (tx: Tx, t: string) => ({ connect: connectRepo(tx, t) })),
    );
    const bell = (link: string, dedup: string) => ({
      tenant_id: B,
      user_id: DUNG,
      kind: "cc.msg",
      title: "Tin nhắn mới từ NitiGroup",
      link,
      dedup_key: dedup,
    });
    const run = (batch: ReturnType<typeof bell>[]) =>
      uow.tenant({ tenantId: A, userId: TIEN }, (r) => r.connect.notify(batch));
    await expect(run([bell("https://evil.example/x", "d0")])).rejects.toThrow();
    await expect(run([bell("//evil.example", "d0")])).rejects.toThrow();
    expect(await run([bell("/contracts/partners?tab=chat", "d1")])).toBe(1);
    expect(await run([bell("/contracts/partners?tab=chat", "d1")])).toBe(0);
    expect(await run([{ ...bell("/contracts/partners", "d2"), tenant_id: C }])).toBe(0); // C chưa kết nối với A (bị từ chối)
  });
});

describe("CR-161 · R6 ngắt kết nối + audit", () => {
  it("ngắt ⇒ 200, xoá hai dòng, chuông cho Dung, audit một dòng; ngắt lần hai ⇒ 409; bài ⇒ 404; người ngoài ⇒ 409/404 không lộ", async () => {
    const d = await call(TIEN, "DELETE", `/connect/links/${B}`);
    expect([d.status, d.body]).toEqual([200, { ok: true }]);
    const rows =
      await o`select 1 from hub.partner_links where (from_tenant = ${A} and to_tenant = ${B}) or (from_tenant = ${B} and to_tenant = ${A})`;
    expect(rows).toHaveLength(0);
    expect((await bells(B, "cc.disconnected")).map((x) => x.user_id)).toEqual([DUNG]);
    const audit = await o<
      { actor_user_id: string; before: Record<string, string>; after: Record<string, string> }[]
    >`
      select actor_user_id, before, after from contracts.approval_settings_audit where tenant_id = ${A}`;
    expect(audit).toHaveLength(1);
    expect(audit[0]?.actor_user_id).toBe(TIEN);
    expect(audit[0]?.before).toMatchObject({
      kind: "cc_link",
      other_tenant: B,
      status: "connected",
    });
    expect(audit[0]?.after).toMatchObject({ kind: "cc_link", other_tenant: B, status: "none" });
    const again = await call(TIEN, "DELETE", `/connect/links/${B}`);
    expect([again.status, code(again)]).toEqual([409, "CONNECT_NOT_CONNECTED"]);
    expect(
      await o`select 1 from contracts.approval_settings_audit where tenant_id = ${A}`,
    ).toHaveLength(1); // 409 không ghi audit
    const posts = await call(TIEN, "GET", `/connect/posts/${B}`);
    expect([posts.status, code(posts)]).toEqual([404, "CONNECT_NOT_CONNECTED"]);
    const stranger = await call(CUONG, "DELETE", `/connect/links/${B}`);
    expect([stranger.status, code(stranger)]).toEqual([409, "CONNECT_NOT_CONNECTED"]);
    expect((await call(TIEN, "DELETE", `/connect/links/${A}`)).status).toBe(400); // tự ngắt
  });
});

describe("CR-161 · quyền DB cho role gói (migration 0116)", () => {
  it("contracts_rw có EXECUTE mọi hàm công khai hub 0145/0146 + community.cc_posts, KHÔNG có hàm nội bộ", async () => {
    const pub = [
      "hub.cc_owner_users(uuid[])",
      "hub.cc_connected(uuid,uuid)",
      "hub.cc_search(text)",
      "hub.cc_invite(uuid,text,uuid,text)",
      "hub.cc_disconnect(uuid)",
      "hub.cc_links(text,timestamptz,uuid,integer)",
      "hub.cc_notify(jsonb)",
      "hub.partner_link_accept(uuid)",
      "hub.partner_link_block(uuid)",
      "community.cc_posts(uuid,timestamptz,uuid,integer)",
    ];
    const internal = [
      "hub.cc_bell(uuid,uuid[],text,text,text,text,text)",
      "hub.cc_owners_raw(uuid[])",
      "hub.cc_connected_raw(uuid,uuid)",
    ];
    const priv = (f: string) =>
      o`select has_function_privilege('contracts_rw', ${f}, 'EXECUTE') as ok`.then(
        (r) => r[0]?.ok as boolean,
      );
    for (const f of pub) expect([f, await priv(f)]).toEqual([f, true]);
    for (const f of internal) expect([f, await priv(f)]).toEqual([f, false]);
    const usage =
      await o`select has_schema_privilege('contracts_rw', 'hub', 'USAGE') as a, has_schema_privilege('contracts_rw', 'community', 'USAGE') as b`;
    expect([usage[0]?.a, usage[0]?.b]).toEqual([true, true]);
  });
});
