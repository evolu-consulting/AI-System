// CR-190 · ghim + «đánh dấu chưa đọc» THEO NGƯỜI (migration contracts 0126) cho cuộc nội bộ (`msg_*`) và cuộc đối tác (`hub.pmsg_*`): route thật (Hono + pool `hub_api` + role
// `contracts_rw` + RLS + hàm DEFINER) + RLS bảng `msg_conv_prefs` trực tiếp. Công ty A (nội bộ + đối tác B), B kết nối A. N2: VY (được giao, KHÔNG phải người tạo TIEN) ghim/đánh dấu;
// TIEN (người tạo) và LAN (cùng công ty, ngoài cuộc) không thấy; DUNG (B, ngoài cuộc) không đụng được; HA là đầu kia của cuộc partner VY–HA, DUNG là người thứ ba.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { ConversationPageSchema, ConvPrefsSchema } from "@ai/contracts/pack-contracts";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inPackAs, inPackAsRollback, openOwner, pgCode, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../../lib/db";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/public";
import { messagesModule } from "./messages.mount";

const A = tenantId(1790);
const B = tenantId(1791);
const TIEN = userId(1790); // A · NGƯỜI TẠO nhóm
const VY = userId(1791); // A · được giao (thành viên), không phải người tạo
const LAN = userId(1792); // A · cùng công ty, NGOÀI cuộc
const DUNG = userId(1793); // B · công ty khác / người thứ ba của cuộc VY–HA
const HA = userId(1794); // B · đầu kia của cuộc partner
const F = { read: "f-r", write: "f-w", admin: "f-a" };
let o: Sql;
let db: Db;
let who: Map<string, { tenant: string; group: string }>;
let grp: Map<string, Record<"owner" | "editor" | "viewer", string>>;

function view(): PackAccessView {
  const all = [A, B];
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
    c.set("user", {
      userId: user,
      tenantId: w?.tenant,
      role: "member",
      userKind: "internal",
    } as never);
    await next();
  });
  h.route("/", messagesModule(db, view()));
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
  return { status: r.status, body: (await r.json().catch(() => null)) as T };
};
const code = (r: Res) => (r.body as { error?: { code?: string } }).error?.code;
const MSG = "/messages";
const P = (id: string) => `${MSG}/partner/${id}`;
const I = (id: string) => `${MSG}/conversations/${id}`;
const group = (user: string, title: string, member_ids: string[]) =>
  call<{ id: string }>(user, "POST", `${MSG}/conversations`, { kind: "group", title, member_ids });
const send = (user: string, base: string, body: string) =>
  call<{ seq: number }>(user, "POST", `${base}/messages`, {
    client_id: randomUUID(),
    body,
    file_ids: [],
  });
const list = async (user: string) => {
  const r = await call(user, "GET", `${MSG}/conversations`);
  return ConversationPageSchema.parse(r.body).items;
};
const flag = async (user: string, id: string) => {
  const c = (await list(user)).find((x) => x.id === id);
  return { pinned: c?.pinned_at != null, marked: c?.marked_unread === true, unread: c?.unread };
};
const total = async (user: string) =>
  (await call<{ total: number }>(user, "GET", `${MSG}/unread`)).body.total;
const rows = (user: string) =>
  o`select conv_kind, pinned_at is not null as pinned, marked_unread_at is not null as marked
    from contracts.msg_conv_prefs where user_id = ${user} order by conv_kind, conv_id`.then((r) => [
    ...r,
  ]);

let g1 = "";
let g2 = "";
let vyHa = "";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'r190-a', 'A', 'NitiGroup', '0100001790', true), (${B}, 'r190-b', 'B', 'Preschool Việt', '0100001791', true)`;
  await users(o, A, 3, { from: 1790 });
  await users(o, B, 2, { from: 1793 });
  grp = await enablePack(o, [A, B], "contracts");
  const g = (t: string, r: "owner" | "editor" | "viewer") => grp.get(t)?.[r] as string;
  await members(o, A, g(A, "owner"), [TIEN]);
  await members(o, A, g(A, "editor"), [VY]);
  await members(o, A, g(A, "viewer"), [LAN]);
  await members(o, B, g(B, "owner"), [DUNG]);
  await members(o, B, g(B, "viewer"), [HA]);
  who = new Map([
    [TIEN, { tenant: A, group: g(A, "owner") }],
    [VY, { tenant: A, group: g(A, "editor") }],
    [LAN, { tenant: A, group: g(A, "viewer") }],
    [DUNG, { tenant: B, group: g(B, "owner") }],
    [HA, { tenant: B, group: g(B, "viewer") }],
  ]);
  const names: [string, string][] = [
    [TIEN, "Tiến"],
    [VY, "Vy"],
    [HA, "Hà"],
    [DUNG, "Dũng"],
    [LAN, "Lan"],
  ];
  for (const [id, n] of names) await o`update admin.users set display_name = ${n} where id = ${id}`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    values (${A}, ${B}, now()), (${B}, ${A}, now())`;
  g1 = (await group(TIEN, "Báo giá Q1", [VY])).body.id;
  g2 = (await group(TIEN, "Kế hoạch", [VY])).body.id;
  await send(TIEN, I(g1), "đơn hàng 1");
  vyHa = (
    await call<{ id: string }>(VY, "POST", `${MSG}/conversations`, {
      kind: "partner",
      tenant_id: B,
      user_id: HA,
    })
  ).body.id;
  await send(VY, P(vyHa), "chào Hà");
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-190 · ghim cuộc nội bộ — theo người", () => {
  it("VY (được giao, không phải người tạo) ghim: VY thấy `pinned_at`, TIEN (người tạo) và LAN thì không, phản hồi đúng contract", async () => {
    const r = await call(VY, "PUT", `${I(g1)}/pin`, { pinned: true });
    const out = ConvPrefsSchema.parse(r.body);
    expect([r.status, out.pinned_at !== null, out.marked_unread]).toEqual([200, true, false]);
    expect((await flag(VY, g1)).pinned).toBe(true);
    expect((await flag(VY, g2)).pinned).toBe(false); // cuộc khác của VY không bị ghim
    expect((await flag(TIEN, g1)).pinned).toBe(false); // cùng cuộc, người khác ⇒ không thấy
    expect(await list(LAN)).toEqual([]);
    expect(await rows(TIEN)).toEqual([]);
  });
  it("ghim lặp lại vô hại, giữ mốc cũ, chi tiết cuộc cũng trả ghim", async () => {
    const a = await call<{ pinned_at: string }>(VY, "PUT", `${I(g1)}/pin`, { pinned: true });
    const b = await call<{ pinned_at: string }>(VY, "PUT", `${I(g1)}/pin`, { pinned: true });
    expect(b.body.pinned_at).toBe(a.body.pinned_at);
    const d = await call<{ pinned_at: string | null }>(VY, "GET", I(g1));
    expect(d.body.pinned_at).toBe(a.body.pinned_at);
    const t = await call<{ pinned_at: string | null }>(TIEN, "GET", I(g1));
    expect(t.body.pinned_at).toBeNull();
  });
  it("người ngoài cuộc (LAN, cùng công ty) và người công ty khác (DUNG) ghim ⇒ 404 `MSG_NOT_FOUND`, không tạo hàng", async () => {
    for (const u of [LAN, DUNG]) {
      const r = await call(u, "PUT", `${I(g1)}/pin`, { pinned: true });
      expect([r.status, code(r)]).toEqual([404, "MSG_NOT_FOUND"]);
      expect(await rows(u)).toEqual([]);
    }
  });
  it("thân sai ⇒ 400, bỏ ghim ⇒ xoá hàng (không để hàng rỗng)", async () => {
    const bad = await call(VY, "PUT", `${I(g1)}/pin`, { pinned: "yes" });
    expect([bad.status, code(bad)]).toEqual([400, "VALIDATION_ERROR"]);
    const r = await call<{ pinned_at: string | null }>(VY, "PUT", `${I(g1)}/pin`, {
      pinned: false,
    });
    expect([r.status, r.body.pinned_at]).toEqual([200, null]);
    expect(await rows(VY)).toEqual([]);
  });
});

describe("CR-190 · đánh dấu chưa đọc cuộc nội bộ", () => {
  it("VY đọc hết rồi đánh dấu: cờ chỉ của VY, cuộc hiển thị «1» chưa đọc, tổng chưa đọc +1, TIEN không bị ảnh hưởng", async () => {
    await call(VY, "POST", `${I(g1)}/read`, { seq: 1 });
    const before = await total(VY);
    const r = await call(VY, "PUT", `${I(g1)}/mark-unread`, { unread: true });
    expect([r.status, ConvPrefsSchema.parse(r.body).marked_unread]).toEqual([200, true]);
    expect(await flag(VY, g1)).toEqual({ pinned: false, marked: true, unread: 1 });
    expect((await flag(TIEN, g1)).marked).toBe(false);
    expect(await total(VY)).toBe(before + 1);
    expect(await total(TIEN)).toBe(0);
  });
  it("mở cuộc (đã đọc) xoá cờ, cuộc đang có tin chưa đọc thật + cờ không bị đếm đôi", async () => {
    await call(VY, "POST", `${I(g1)}/read`, { seq: 1 });
    expect((await flag(VY, g1)).marked).toBe(false);
    expect(await rows(VY)).toEqual([]);
    await send(TIEN, I(g1), "tin mới"); // VY có 1 tin chưa đọc thật
    const t0 = await total(VY);
    await call(VY, "PUT", `${I(g1)}/mark-unread`, { unread: true });
    expect(await total(VY)).toBe(t0);
    await call(VY, "PUT", `${I(g1)}/mark-unread`, { unread: false });
    expect((await flag(VY, g1)).marked).toBe(false);
  });
  it("ghim + cờ cùng lúc: mở cuộc xoá cờ giữ ghim, bỏ ghim xoá hàng, người ngoài (LAN, DUNG) đánh dấu ⇒ 404", async () => {
    await call(VY, "PUT", `${I(g2)}/pin`, { pinned: true });
    await call(VY, "PUT", `${I(g2)}/mark-unread`, { unread: true });
    expect(await rows(VY)).toEqual([{ conv_kind: "internal", pinned: true, marked: true }]);
    await call(VY, "POST", `${I(g2)}/read`, { seq: 0 });
    expect(await rows(VY)).toEqual([{ conv_kind: "internal", pinned: true, marked: false }]);
    await call(VY, "PUT", `${I(g2)}/pin`, { pinned: false });
    expect(await rows(VY)).toEqual([]);
    for (const u of [LAN, DUNG]) {
      const r = await call(u, "PUT", `${I(g2)}/mark-unread`, { unread: true });
      expect([r.status, code(r)]).toEqual([404, "MSG_NOT_FOUND"]);
    }
  });
});

describe("CR-190 · cuộc đối tác (hub.pmsg_*)", () => {
  it("HA (đầu kia, không phải người mở cuộc) ghim + đánh dấu: VY (người mở) không thấy, DUNG (người thứ ba) và LAN ⇒ 404, không tạo hàng", async () => {
    expect((await call(HA, "PUT", `${P(vyHa)}/pin`, { pinned: true })).status).toBe(200);
    const m = await call(HA, "PUT", `${P(vyHa)}/mark-unread`, { unread: true });
    expect(ConvPrefsSchema.parse(m.body).marked_unread).toBe(true);
    const ha = (await list(HA)).find((c) => c.id === vyHa);
    expect([ha?.kind, ha?.pinned_at != null, ha?.marked_unread]).toEqual(["partner", true, true]);
    const vy = (await list(VY)).find((c) => c.id === vyHa);
    expect([vy?.pinned_at, vy?.marked_unread]).toEqual([null, false]);
    const det = await call<{ pinned_at: string | null; marked_unread: boolean }>(
      HA,
      "GET",
      P(vyHa),
    );
    expect([det.status, det.body.pinned_at !== null, det.body.marked_unread]).toEqual([
      200,
      true,
      true,
    ]);
    for (const u of [DUNG, LAN]) {
      const r = await call(u, "PUT", `${P(vyHa)}/pin`, { pinned: true });
      expect([r.status, code(r)]).toEqual([404, "MSG_NOT_FOUND"]);
      expect(await rows(u)).toEqual([]);
    }
  });
  it("tổng chưa đọc của HA tính cả cờ, mở cuộc (đã đọc) xoá cờ, giữ ghim", async () => {
    expect(await total(HA)).toBeGreaterThanOrEqual(1);
    await call(HA, "POST", `${P(vyHa)}/read`, { seq: 1 });
    expect(await rows(HA)).toEqual([{ conv_kind: "partner", pinned: true, marked: false }]);
    expect((await flag(HA, vyHa)).marked).toBe(false);
    expect(await rows(VY)).toEqual([]);
    await call(HA, "PUT", `${P(vyHa)}/pin`, { pinned: false });
    expect(await rows(HA)).toEqual([]);
  });
});

describe("CR-190 · cờ và chưa đọc thật khớp nhau: badge = danh sách (cuộc đối tác + nội bộ)", () => {
  let td = "";
  const unreadIds = async (u: string) => {
    const r = await call(u, "GET", `${MSG}/conversations?unread=true`);
    return ConversationPageSchema.parse(r.body).items.map((c) => c.id);
  };
  it("cuộc đối tác vừa có tin chưa đọc thật vừa có cờ: tổng không đổi, cuộc hiển thị 1 (không 2)", async () => {
    td = (
      await call<{ id: string }>(TIEN, "POST", `${MSG}/conversations`, {
        kind: "partner",
        tenant_id: B,
        user_id: DUNG,
      })
    ).body.id;
    await send(TIEN, P(td), "một");
    const t0 = await total(DUNG);
    const r = await call(DUNG, "PUT", `${P(td)}/mark-unread`, { unread: true });
    expect(r.status).toBe(200);
    expect(await total(DUNG)).toBe(t0);
    expect((await flag(DUNG, td)).unread).toBe(1);
    await send(TIEN, P(td), "hai");
    expect(await total(DUNG)).toBe(t0 + 1); // tin thật tăng thì tổng tăng đúng 1, cờ không cộng thêm
    expect((await flag(DUNG, td)).unread).toBe(2);
  });
  it("cuộc đối tác chỉ có cờ (đã đọc hết): tổng +1 và vào bộ lọc «Chưa đọc», mở cuộc thì ra khỏi cả hai", async () => {
    await call(DUNG, "POST", `${P(td)}/read`, { seq: 2 });
    expect(await unreadIds(DUNG)).toEqual([]);
    const t0 = await total(DUNG);
    await call(DUNG, "PUT", `${P(td)}/mark-unread`, { unread: true });
    expect(await total(DUNG)).toBe(t0 + 1);
    expect(await unreadIds(DUNG)).toEqual([td]);
    expect((await flag(DUNG, td)).unread).toBe(1);
    await call(DUNG, "POST", `${P(td)}/read`, { seq: 2 });
    expect(await total(DUNG)).toBe(t0);
    expect(await unreadIds(DUNG)).toEqual([]);
  });
  it("cuộc nội bộ chỉ có cờ vào bộ lọc «Chưa đọc» của người đánh dấu, không của người khác", async () => {
    await call(VY, "POST", `${I(g2)}/read`, { seq: 0 });
    const before = await unreadIds(VY);
    expect(before).not.toContain(g2);
    await call(VY, "PUT", `${I(g2)}/mark-unread`, { unread: true });
    expect(await unreadIds(VY)).toContain(g2);
    expect(await unreadIds(TIEN)).not.toContain(g2);
    await call(VY, "POST", `${I(g2)}/read`, { seq: 0 });
    expect(await unreadIds(VY)).not.toContain(g2);
  });
  it("cờ của cuộc đối tác mà người gọi không còn là một đầu (dữ liệu lạc) không được đếm và không vào bộ lọc", async () => {
    const t0 = await total(DUNG);
    await o`insert into contracts.msg_conv_prefs (tenant_id, user_id, conv_kind, conv_id, marked_unread_at)
      values (${B}, ${DUNG}, 'partner', ${vyHa}, now())`; // DUNG không là đầu của cuộc VY–HA
    expect(await total(DUNG)).toBe(t0);
    expect(await unreadIds(DUNG)).not.toContain(vyHa);
    await o`delete from contracts.msg_conv_prefs where user_id = ${DUNG} and conv_id = ${vyHa}`;
  });
});

describe("CR-190 · RLS `contracts.msg_conv_prefs` (role gói, DB thật)", () => {
  const PREF = "c1900000-0000-4000-8000-000000000001";
  beforeAll(async () => {
    await o`insert into contracts.msg_conv_prefs (tenant_id, user_id, conv_kind, conv_id, pinned_at)
      values (${A}, ${VY}, 'partner', ${PREF}, now())`;
  });
  const mine = (tx: Sql) => tx`select user_id from contracts.msg_conv_prefs`;
  it("chỉ chính chủ đọc: TIEN (cùng công ty), DUNG (công ty khác) thấy 0, VY thấy 1", async () => {
    expect((await inPackAs("contracts", A, VY, mine)).length).toBe(1);
    expect((await inPackAs("contracts", A, TIEN, mine)).length).toBe(0);
    expect((await inPackAs("contracts", B, DUNG, mine)).length).toBe(0);
    expect((await inPackAs("contracts", B, VY, mine)).length).toBe(0); // đúng người nhưng sai công ty
  });
  it("không ghi hộ người khác, cuộc nội bộ không phải thành viên không ghim được, sửa/xoá hàng người khác không tác dụng", async () => {
    const forge = await pgCode(() =>
      inPackAsRollback(
        "contracts",
        A,
        TIEN,
        (
          tx,
        ) => tx`insert into contracts.msg_conv_prefs (tenant_id, user_id, conv_kind, conv_id, pinned_at)
          values (${A}, ${VY}, 'partner', ${randomUUID()}, now())`,
      ),
    );
    expect(forge).toBe("42501");
    const notMember = await pgCode(() =>
      inPackAsRollback(
        "contracts",
        A,
        LAN,
        (
          tx,
        ) => tx`insert into contracts.msg_conv_prefs (tenant_id, user_id, conv_kind, conv_id, pinned_at)
          values (${A}, ${LAN}, 'internal', ${g1}, now())`,
      ),
    );
    expect(notMember).toBe("42501");
    const upd = await inPackAsRollback(
      "contracts",
      A,
      TIEN,
      (tx) => tx`update contracts.msg_conv_prefs set pinned_at = null returning 1`,
    );
    const del = await inPackAsRollback(
      "contracts",
      A,
      TIEN,
      (tx) => tx`delete from contracts.msg_conv_prefs returning 1`,
    );
    expect([upd.length, del.length]).toEqual([0, 0]);
    expect((await rows(VY)).length).toBe(1);
  });
});
