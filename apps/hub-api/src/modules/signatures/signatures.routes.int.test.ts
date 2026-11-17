// CR-181 · lát s2 · int (DB thật, role `hub_api`) cho route chữ ký nội bộ dựng bằng `mountSignatures` (JWT giả theo header `x-who`).
// BR-K1..K4 · BR-G1 (chỉ quản trị: tenant_admin HOẶC quản trị gói — ca «người được giao quyền gói, không phải tenant admin») · BR-G3 audit trước/sau ·
// Q10 xin đổi → chuông → cho phép một lần · `needs_create` 4 trường hợp · người B không thấy chữ ký A · hàm công khai cho lát s8.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SIGNATURE_PNG_MAX_BYTES, type SignatureSettings } from "@ai/contracts/signature";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../lib/auth.middleware";
import { mapError } from "../../lib/errors";
import type { PackAccessView } from "../packs/kit/public";
import { getSignatureSettings, mountSignatures, signatureForStamp } from "./public";

const T = { a: tenantId(1820), b: tenantId(1821) };
const U = {
  adm: userId(1820), // tenant_admin
  host: userId(1821), // member + quản trị gói Sổ Hợp Tác (không phải tenant admin)
  hoa: userId(1822), // member thường
  tam: userId(1823), // member thường (người B trong cùng công ty)
  other: userId(1824), // công ty khác
};
type Who = keyof typeof U;
const ROLE: Record<Who, "tenant_admin" | "member"> = {
  adm: "tenant_admin",
  host: "member",
  hoa: "member",
  tam: "member",
  other: "member",
};
const TENANT_OF: Record<Who, string> = { adm: T.a, host: T.a, hoa: T.a, tam: T.a, other: T.b };

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngBytes = (n: number, fill = 1) =>
  Buffer.from([...PNG_HEAD, ...new Array<number>(n - 8).fill(fill)]);
const b64 = (b: Buffer) => b.toString("base64");

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let adminGroup = "";
let seq0 = 0; // mốc audit đầu mỗi test (audit append-only, không xoá được)

const view = (): PackAccessView => ({
  catalog: async () => ({
    features: [
      { id: "f-r", key: "contracts-read", status: "on" },
      { id: "f-a", key: "contracts-admin", status: "on" },
    ],
    entitled: new Set([`${T.a}:f-r`, `${T.a}:f-a`]),
    grantGroups: new Map([
      [`${T.a}:f-r`, [adminGroup]],
      [`${T.a}:f-a`, [adminGroup]],
    ]),
  }),
  user: async (id) => ({
    tenantId: TENANT_OF[(Object.keys(U) as Who[]).find((k) => U[k] === id) ?? "hoa"],
    groupIds: new Set(id === U.host ? [adminGroup] : []),
  }),
});

// biome-ignore lint/suspicious/noExplicitAny: JSON của test
type Json = Record<string, any>;
type R = { status: number; json: Json };
async function call(who: Who | null, method: string, path: string, body?: unknown): Promise<R> {
  const headers: Record<string, string> = {};
  if (who) headers["x-who"] = who;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : {} };
}
const code = (r: R): string | undefined => r.json.error?.code;
const mk = (b: Buffer, over: Record<string, unknown> = {}) => ({
  kind: "main",
  method: "draw",
  png: b64(b),
  ...over,
});
const putSettings = (who: Who, over: Partial<SignatureSettings> = {}) =>
  call(who, "PUT", "/company/signature-settings", {
    methods: ["draw", "upload", "type"],
    required: true,
    caption: ["name", "date"],
    ink: "blue",
    initials: "shrink",
    change_policy: "self",
    on_doc_enabled: true,
    digital_enabled: false,
    digital_provider: null,
    ...over,
  });
const audit = async (action: string) =>
  o<
    { actor_id: string; before: Json; after: Json; summary: Json; actor_username: string | null }[]
  >`select actor_id, before, after, summary, actor_username from hub.audit_log
    where tenant_id = ${T.a} and entity = 'signature' and action = ${action} and seq > ${seq0} order by seq`;
const bellUsers = async (kind: string) =>
  (
    await o<{ user_id: string }[]>`select user_id from hub.notifications
      where tenant_id = ${T.a} and kind = ${kind} order by user_id`
  ).map((b) => b.user_id);

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name) values (${T.a}, 'p1820', 'P1820'), (${T.b}, 'p1821', 'P1821') on conflict do nothing`;
  await users(o, T.a, 1, { from: 1820, role: "tenant_admin" });
  await users(o, T.a, 3, { from: 1821 });
  await users(o, T.b, 1, { from: 1824 });
  const [g] = await o<{ id: string }[]>`insert into admin.groups (tenant_id, key, name)
    values (${T.a}, 'sig-host', ${o.json({ vi: "Chủ quản" })}) returning id::text as id`;
  adminGroup = g?.id as string;
  await o`insert into admin.group_members (tenant_id, group_id, user_id) values (${T.a}, ${adminGroup}, ${U.host})`;
  db = createDb(urls().hubApi, { max: 4 });
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    const w = c.req.header("x-who") as Who | undefined;
    if (!w) return c.json({ error: { code: "AUTH_EXPIRED", message: "x" } }, 401);
    c.set("user", { userId: U[w], tenantId: TENANT_OF[w], role: ROLE[w] });
    await next();
  });
  app.onError((err, c) => {
    const { status, body } = mapError(err);
    return c.json(body, status);
  });
  mountSignatures(app, { db, view: view() });
}, 120_000);
afterAll(async () => {
  await o?.end({ timeout: 2 });
});
beforeEach(async () => {
  const [m] = await o<{ m: string }[]>`select coalesce(max(seq), 0)::text as m from hub.audit_log`;
  seq0 = Number(m?.m ?? 0);
  await o`delete from hub.user_signatures where tenant_id in (${T.a}, ${T.b})`;
  await o`delete from hub.signature_change_grants where tenant_id in (${T.a}, ${T.b})`;
  await o`delete from hub.signature_settings where tenant_id in (${T.a}, ${T.b})`;
  await o`delete from hub.notifications where tenant_id = ${T.a}`;
});

describe("CR-181 s2 · BR-G1 cấu hình định dạng chỉ quản trị công ty (Q15)", () => {
  it("người thường PUT ⇒ 403 SIGNATURE_FORBIDDEN, thiết lập không đổi", async () => {
    const r = await putSettings("hoa", { ink: "black" });
    expect(r.status).toBe(403);
    expect(code(r)).toBe("SIGNATURE_FORBIDDEN");
    const g = await call("hoa", "GET", "/company/signature-settings");
    expect(g.status).toBe(200);
    expect(g.json.stored).toBe(false);
    expect(g.json.can_edit).toBe(false);
  });
  it("tenant admin ⇒ 200, người được giao quyền admin gói (không phải tenant admin) ⇒ 200", async () => {
    const a = await putSettings("adm", { ink: "black" });
    expect(a.status).toBe(200);
    expect(a.json.settings.ink).toBe("black");
    expect(a.json.stored).toBe(true);
    const h = await putSettings("host", { ink: "blue", caption: ["name"] });
    expect(h.status).toBe(200);
    expect(h.json.settings.caption).toEqual(["name"]);
    const seen = await call("tam", "GET", "/company/signature-settings"); // mọi thành viên đọc được
    expect(seen.json.settings.ink).toBe("blue");
    expect((await call("host", "GET", "/company/signature-settings")).json.can_edit).toBe(true);
  });
  it("body sai ⇒ 400, trường lạ ⇒ 400, không token ⇒ 401", async () => {
    expect((await putSettings("adm", { methods: [] })).status).toBe(400);
    expect((await call("adm", "PUT", "/company/signature-settings", { x: 1 })).status).toBe(400);
    expect((await call(null, "GET", "/me/signature")).status).toBe(401);
  });
  it("BR-G3: audit có hàng, người làm, trước/sau (không có ảnh)", async () => {
    await putSettings("adm", { ink: "black" });
    await putSettings("host", { ink: "blue" });
    const rows = await audit("signature_settings_changed");
    expect(rows.length).toBe(2);
    expect(rows[0]?.actor_id).toBe(U.adm);
    expect(rows[0]?.before.ink).toBe("blue"); // mặc định
    expect(rows[0]?.before.stored).toBe(false);
    expect(rows[0]?.after.ink).toBe("black");
    expect(rows[1]?.actor_id).toBe(U.host);
    expect(rows[1]?.before.ink).toBe("black");
    expect(rows[1]?.actor_username).toBeTruthy();
  });
});

describe("CR-181 s2 · POST /me/signature (BR-K1..K4)", () => {
  it("tạo lần đầu 201, đổi ⇒ bản cũ vào lịch sử, 1 bản đang dùng, audit trước/sau là id", async () => {
    const a = await call("hoa", "POST", "/me/signature", mk(pngBytes(100, 1)));
    expect(a.status).toBe(201);
    expect(a.json.replaced_id).toBeNull();
    expect(a.json.signature.image.startsWith("data:image/png;base64,")).toBe(true);
    const b = await call(
      "hoa",
      "POST",
      "/me/signature",
      mk(pngBytes(120, 2), { method: "upload" }),
    );
    expect(b.status).toBe(201);
    expect(b.json.replaced_id).toBe(a.json.signature.id);
    const me = await call("hoa", "GET", "/me/signature");
    expect(me.json.main.id).toBe(b.json.signature.id);
    expect(me.json.history.length).toBe(2);
    expect(me.json.history.filter((h: Json) => h.retired_at === null).length).toBe(1);
    expect(me.json.digital).toEqual({ enabled: false, assigned: false });
    const rows = (await audit("signature_created")).filter((x) => x.actor_id === U.hoa);
    expect(rows.length).toBe(2);
    expect(rows[1]?.before.signature_id).toBe(a.json.signature.id);
    expect(rows[1]?.after.signature_id).toBe(b.json.signature.id);
    expect(JSON.stringify(rows)).not.toContain(b64(pngBytes(120, 2)).slice(0, 20));
  });
  it("PNG > 200 KiB ⇒ 413, không phải PNG ⇒ 415, base64 sai ⇒ 400, đúng 200 KiB ⇒ 201, có user_id ⇒ 400", async () => {
    const big = await call(
      "hoa",
      "POST",
      "/me/signature",
      mk(pngBytes(SIGNATURE_PNG_MAX_BYTES + 1)),
    );
    expect(big.status).toBe(413);
    expect(code(big)).toBe("SIGNATURE_TOO_LARGE");
    const bad = await call("hoa", "POST", "/me/signature", mk(Buffer.alloc(500, 9)));
    expect(bad.status).toBe(415);
    expect(code(bad)).toBe("SIGNATURE_NOT_PNG");
    const junk = await call("hoa", "POST", "/me/signature", mk(pngBytes(100), { png: "***" }));
    expect(junk.status).toBe(400);
    const edge = await call("hoa", "POST", "/me/signature", mk(pngBytes(SIGNATURE_PNG_MAX_BYTES)));
    expect(edge.status).toBe(201);
    const other = await call("hoa", "POST", "/me/signature", {
      ...mk(pngBytes(100)),
      user_id: U.tam,
    });
    expect(other.status).toBe(400); // BR-K2: không có tham số người dùng
  });
  it("BR-K4: cách tạo ngoài methods ⇒ 422, initials khi shrink ⇒ 422, own ⇒ 201", async () => {
    await putSettings("adm", { methods: ["draw"] });
    const m = await call("hoa", "POST", "/me/signature", mk(pngBytes(100), { method: "upload" }));
    expect(m.status).toBe(422);
    expect(code(m)).toBe("SIGNATURE_METHOD_NOT_ALLOWED");
    const i = await call("hoa", "POST", "/me/signature", mk(pngBytes(100), { kind: "initials" }));
    expect(i.status).toBe(422);
    expect(code(i)).toBe("SIGNATURE_INITIALS_NOT_ALLOWED");
    await putSettings("adm", { methods: ["draw"], initials: "own" });
    const ok = await call("hoa", "POST", "/me/signature", mk(pngBytes(100), { kind: "initials" }));
    expect(ok.status).toBe(201);
    expect((await call("hoa", "GET", "/me/signature")).json.initials.kind).toBe("initials");
  });
  it("BR-K2: người B không thấy chữ ký của A (cùng công ty và công ty khác)", async () => {
    await call("hoa", "POST", "/me/signature", mk(pngBytes(100, 5)));
    for (const w of ["tam", "other"] as const) {
      const r = await call(w, "GET", "/me/signature");
      expect(r.json.main).toBeNull();
      expect(r.json.history).toEqual([]);
    }
  });
});

describe("CR-181 s2 · needs_create đúng 4 trường hợp", () => {
  it("(1) tắt ký trên tài liệu ⇒ false", async () => {
    await putSettings("adm", { on_doc_enabled: false });
    const r = await call("hoa", "GET", "/me/signature");
    expect(r.json.needs_create).toBe(false);
    expect(r.json.can_change).toBe(true);
  });
  it("(2) bật + chưa có chữ ký ⇒ true (required=false vẫn true, web dùng «Làm sau»)", async () => {
    await putSettings("adm", { required: false });
    const r = await call("hoa", "GET", "/me/signature");
    expect(r.json.needs_create).toBe(true);
    expect(r.json.settings.required).toBe(false);
  });
  it("(3) bật + có chữ ký theo cách còn cho phép ⇒ false", async () => {
    await putSettings("adm");
    await call("hoa", "POST", "/me/signature", mk(pngBytes(100)));
    expect((await call("hoa", "GET", "/me/signature")).json.needs_create).toBe(false);
  });
  it("(4) cách tạo của bản đang dùng bị bỏ khỏi methods ⇒ true, tạo lại KHÔNG cần quyền đổi dù policy admin", async () => {
    await putSettings("adm", { change_policy: "admin" });
    await call("hoa", "POST", "/me/signature", mk(pngBytes(100), { method: "draw" }));
    await putSettings("adm", { change_policy: "admin", methods: ["type"] });
    const r = await call("hoa", "GET", "/me/signature");
    expect(r.json.needs_create).toBe(true);
    expect(r.json.can_change).toBe(true);
    const again = await call("hoa", "POST", "/me/signature", mk(pngBytes(110), { method: "type" }));
    expect(again.status).toBe(201);
    expect((await call("hoa", "GET", "/me/signature")).json.needs_create).toBe(false);
  });
});

describe("CR-181 s2 · Q10 policy admin: xin đổi → chuông → cho phép một lần", () => {
  it("không grant ⇒ 403, xin (201 + chuông, 200 lần hai không báo lại), quản trị gói (khác người xin, không phải tenant admin) cho phép ⇒ 201, đổi được đúng một lần", async () => {
    await putSettings("adm", { change_policy: "admin" });
    const first = await call("hoa", "POST", "/me/signature", mk(pngBytes(100, 1)));
    expect(first.status).toBe(201); // lần đầu luôn được
    let me = await call("hoa", "GET", "/me/signature");
    expect(me.json.can_change).toBe(false);
    expect(me.json.change).toBe("none");
    const blocked = await call("hoa", "POST", "/me/signature", mk(pngBytes(100, 2)));
    expect(blocked.status).toBe(403);
    expect(code(blocked)).toBe("SIGNATURE_CHANGE_NOT_ALLOWED");

    const req = await call("hoa", "POST", "/me/signature/change-request");
    expect(req.status).toBe(201);
    expect(req.json.change).toBe("requested");
    expect((await call("hoa", "POST", "/me/signature/change-request")).status).toBe(200);
    // chuông một lần, đủ quản trị (tenant admin + quản trị gói), không báo người xin
    expect(await bellUsers("signature.change_requested")).toEqual([U.adm, U.host].sort());
    expect((await audit("signature_change_requested")).length).toBe(1);

    expect((await call("hoa", "GET", "/company/signature-change-requests")).status).toBe(403);
    const list = await call("host", "GET", "/company/signature-change-requests");
    expect(list.status).toBe(200);
    expect(list.json.items.map((x: Json) => x.user_id)).toEqual([U.hoa]);
    expect(list.json.items[0].granted_at).toBeNull();

    const forbidden = await call("hoa", "POST", "/company/signature-change-grants", {
      user_id: U.hoa,
    });
    expect(forbidden.status).toBe(403);
    const g = await call("host", "POST", "/company/signature-change-grants", { user_id: U.hoa });
    expect(g.status).toBe(201);
    const g2 = await call("host", "POST", "/company/signature-change-grants", { user_id: U.hoa });
    expect(g2.status).toBe(200);
    expect((await audit("signature_change_granted")).length).toBe(1);
    expect(await bellUsers("signature.change_granted")).toEqual([U.hoa]);
    me = await call("hoa", "GET", "/me/signature");
    expect(me.json.change).toBe("granted");
    expect(me.json.can_change).toBe(true);

    const done = await call("hoa", "POST", "/me/signature", mk(pngBytes(100, 3)));
    expect(done.status).toBe(201);
    const again = await call("hoa", "POST", "/me/signature", mk(pngBytes(100, 4)));
    expect(again.status).toBe(403); // quyền đã dùng hết
    expect(code(again)).toBe("SIGNATURE_CHANGE_NOT_ALLOWED");
    me = await call("hoa", "GET", "/me/signature");
    expect(me.json.change).toBe("none");
    expect((await call("host", "GET", "/company/signature-change-requests")).json.items).toEqual(
      [],
    );
  });
  it("PNG hỏng bị chặn TRƯỚC khi tiêu quyền đổi (quyền còn nguyên)", async () => {
    await putSettings("adm", { change_policy: "admin" });
    await call("hoa", "POST", "/me/signature", mk(pngBytes(100, 1)));
    await call("adm", "POST", "/company/signature-change-grants", { user_id: U.hoa });
    const bad = await call("hoa", "POST", "/me/signature", mk(Buffer.alloc(300, 9)));
    expect(bad.status).toBe(415);
    const ok = await call("hoa", "POST", "/me/signature", mk(pngBytes(100, 2)));
    expect(ok.status).toBe(201);
  });
  it("xin đổi khi policy self ⇒ 409, tự cấp cho mình ⇒ 403, cấp cho người công ty khác ⇒ 404, cấp trước khi xin vẫn được", async () => {
    await call("hoa", "POST", "/me/signature", mk(pngBytes(100)));
    expect((await call("hoa", "POST", "/me/signature/change-request")).status).toBe(409);
    await putSettings("adm", { change_policy: "admin" });
    const self = await call("adm", "POST", "/company/signature-change-grants", { user_id: U.adm });
    expect(self.status).toBe(403);
    expect(code(self)).toBe("SIGNATURE_SELF_GRANT");
    const out = await call("adm", "POST", "/company/signature-change-grants", {
      user_id: U.other,
    });
    expect(out.status).toBe(404);
    expect(code(out)).toBe("SIGNATURE_USER_NOT_FOUND");
    const ok = await call("adm", "POST", "/company/signature-change-grants", { user_id: U.tam });
    expect(ok.status).toBe(201);
  });
});

describe("CR-181 s2 · hàm công khai cho gói khác (lát s8)", () => {
  it("getSignatureSettings: mặc định khi chưa lưu, theo công ty khi đã lưu, signatureForStamp: đúng người, null khi chưa có", async () => {
    expect((await getSignatureSettings(db, T.b)).on_doc_enabled).toBe(false);
    await putSettings("adm", { ink: "black" });
    expect((await getSignatureSettings(db, T.a)).ink).toBe("black");
    expect((await getSignatureSettings(db, T.b)).ink).toBe("blue");
    expect(await signatureForStamp(db, { tenantId: T.a, userId: U.hoa }, "main")).toBeNull();
    const made = await call("hoa", "POST", "/me/signature", mk(pngBytes(100, 6)));
    const s = await signatureForStamp(db, { tenantId: T.a, userId: U.hoa }, "main");
    expect(s?.id).toBe(made.json.signature.id);
    expect(s?.png.equals(pngBytes(100, 6))).toBe(true);
    expect(await signatureForStamp(db, { tenantId: T.a, userId: U.tam }, "main")).toBeNull();
  });
});
