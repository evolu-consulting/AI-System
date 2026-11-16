// CR-178 · API đọc «Tin nhắn» (M5 lọc chưa đọc · M4 ảnh & tệp · M3 tìm tin) trên route thật (Hono + pool `hub_api` + role `contracts_rw` + RLS + hàm DEFINER `hub.pmsg_*`).
// Công ty A (nội bộ + đối tác B, C), B kết nối A, C kết nối A nhưng KHÔNG với B. N2: người được giao (VY, không phải người tạo TIEN) mới là người đọc; LAN cùng công ty nhưng ngoài cuộc;
// DUNG (B) là người thứ ba của cuộc VY–HA; CUONG (C) là công ty thứ ba của cuộc A–B.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../../lib/db";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/public";
import { messagesModule } from "./messages.mount";

const A = tenantId(1780);
const B = tenantId(1781);
const C = tenantId(1782);
const TIEN = userId(1780); // A · Toàn quyền, NGƯỜI TẠO cuộc nội bộ
const VY = userId(1781); // A · được giao (thành viên), không phải người tạo
const LAN = userId(1782); // A · cùng công ty, NGOÀI cuộc
const ANH = userId(1783); // A · được giao, nhưng chỉ ở một cuộc
const DUNG = userId(1784); // B · Toàn quyền, ngoài cuộc VY–HA
const HA = userId(1785); // B · đầu kia của cuộc partner
const CUONG = userId(1786); // C · công ty thứ ba của cuộc A–B
const F = { read: "f-r", write: "f-w", admin: "f-a" };
let o: Sql;
let db: Db;
/** FileBox giả. */
const box = { live: new Set<string>() };
const fakeBox = (org: string) => ({
  postFile: async () => {
    const fileId = randomUUID().replaceAll("-", "").slice(0, 16);
    box.live.add(fileId);
    return { fileId, versionId: "v1" };
  },
  getLink: async (id: string) => (box.live.has(id) ? `https://fb.test/${org}/${id}` : null),
  deleteFile: async (id: string) =>
    box.live.delete(id) ? ("deleted" as const) : ("missing" as const),
});
let who: Map<string, { tenant: string; group: string }>;
let grp: Map<string, Record<"owner" | "editor" | "viewer", string>>;

function view(): PackAccessView {
  const all = [A, B, C];
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
  h.route("/", messagesModule(db, view(), { filebox: fakeBox }));
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
const partner = (user: string, tenant: string, peer: string) =>
  call<{ id: string }>(user, "POST", `${MSG}/conversations`, {
    kind: "partner",
    tenant_id: tenant,
    user_id: peer,
  });
type Sent = { seq: number; id: string; files: { id: string }[] };
/** `base` = `/messages/conversations/:id` (nội bộ) hoặc `/messages/partner/:id`. */
const send = (user: string, base: string, body: string, file_ids: string[] = []) =>
  call<Sent>(user, "POST", `${base}/messages`, { client_id: randomUUID(), body, file_ids });
const upload = async (user: string, base: string, name: string, bytes: Uint8Array) => {
  const fd = new FormData();
  fd.set("file", new File([Buffer.from(bytes)], name));
  const r = await app(user).request(`${base}/files`, { method: "POST", body: fd });
  return { status: r.status, body: (await r.json()) as { id: string; error?: { code?: string } } };
};
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const PDF = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
type Conv = { id: string; kind: string; unread: number; company: { id: string } | null };
type ConvPage = { items: Conv[]; next_cursor: string | null };

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'r8-a', 'A', 'NitiGroup', '0100000781', true), (${B}, 'r8-b', 'B', 'Preschool Việt', '0100000782', true),
           (${C}, 'r8-c', 'C', 'Công ty Cờ', '0100000783', true)`;
  await users(o, A, 4, { from: 1780 });
  await users(o, B, 2, { from: 1784 });
  await users(o, C, 1, { from: 1786 });
  grp = await enablePack(o, [A, B, C], "contracts");
  const g = (t: string, r: "owner" | "editor" | "viewer") => grp.get(t)?.[r] as string;
  await members(o, A, g(A, "owner"), [TIEN]);
  await members(o, A, g(A, "editor"), [VY, ANH]);
  await members(o, A, g(A, "viewer"), [LAN]);
  await members(o, B, g(B, "owner"), [DUNG]);
  await members(o, B, g(B, "viewer"), [HA]);
  await members(o, C, g(C, "owner"), [CUONG]);
  who = new Map([
    [TIEN, { tenant: A, group: g(A, "owner") }],
    [VY, { tenant: A, group: g(A, "editor") }],
    [ANH, { tenant: A, group: g(A, "editor") }],
    [LAN, { tenant: A, group: g(A, "viewer") }],
    [DUNG, { tenant: B, group: g(B, "owner") }],
    [HA, { tenant: B, group: g(B, "viewer") }],
    [CUONG, { tenant: C, group: g(C, "owner") }],
  ]);
  await o`update admin.users set display_name = 'Tiến' where id = ${TIEN}`;
  await o`update admin.users set display_name = 'Vy' where id = ${VY}`;
  await o`update admin.users set display_name = 'Hà' where id = ${HA}`;
  await o`update admin.users set display_name = 'Dũng' where id = ${DUNG}`;
  await o`update admin.users set display_name = 'Cuong' where id = ${CUONG}`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    values (${A}, ${B}, now()), (${B}, ${A}, now()), (${A}, ${C}, now()), (${C}, ${A}, now())`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-178 M5 · ?unread=true lọc chưa đọc ở máy chủ (nội bộ + partner, keyset)", () => {
  let g1 = "";
  let g2 = "";
  let g3 = "";
  let vyHa = "";
  let dungHa = "";
  it("người được giao (VY, không phải người tạo TIEN) chỉ thấy cuộc có tin chưa đọc; tin của chính mình và tin đã thu hồi không tính; người ngoài cuộc (LAN) không thấy gì", async () => {
    g1 = (await group(TIEN, "Báo giá Q1", [VY])).body.id;
    g2 = (await group(TIEN, "Kế hoạch", [VY])).body.id;
    g3 = (await group(TIEN, "Nhầm lẫn", [VY])).body.id;
    await send(TIEN, I(g1), "báo giá 1"); // VY chưa đọc
    await send(VY, I(g2), "em gửi anh"); // TIEN chưa đọc; với VY là tin của chính mình
    const s3 = await send(TIEN, I(g3), "gửi nhầm");
    await call(TIEN, "DELETE", `${I(g3)}/messages/${s3.body.seq}`); // thu hồi ⇒ không còn chưa đọc
    const vy = await call<ConvPage>(VY, "GET", `${MSG}/conversations?unread=true`);
    expect([vy.status, vy.body.items.map((c) => c.id), vy.body.items[0]?.unread]).toEqual([
      200,
      [g1],
      1,
    ]);
    const tien = await call<ConvPage>(TIEN, "GET", `${MSG}/conversations?unread=true`);
    expect(tien.body.items.map((c) => c.id)).toEqual([g2]);
    const lan = await call<ConvPage>(LAN, "GET", `${MSG}/conversations?unread=true`);
    expect([lan.status, lan.body.items.length]).toEqual([200, 0]);
    const all = await call<ConvPage>(VY, "GET", `${MSG}/conversations?unread=false`);
    expect(all.body.items.map((c) => c.id).sort()).toEqual([g1, g2, g3].sort());
  });
  it("đọc xong thì rời danh sách chưa đọc; giá trị sai ⇒ 400", async () => {
    await call(VY, "POST", `${I(g1)}/read`, { seq: 1 });
    const vy = await call<ConvPage>(VY, "GET", `${MSG}/conversations?unread=true`);
    expect(vy.body.items.length).toBe(0);
    const bad = await call(VY, "GET", `${MSG}/conversations?unread=abc`);
    expect([bad.status, code(bad)]).toEqual([400, "VALIDATION_ERROR"]);
  });
  it("trộn partner: HA thấy cả cuộc nội bộ (DUNG gửi) lẫn cuộc partner (VY gửi), mới nhất trước, keyset 1 dòng/trang; người gửi và người thứ ba không thấy", async () => {
    vyHa = (await partner(VY, B, HA)).body.id;
    dungHa = (await group(DUNG, "Nội bộ B", [HA])).body.id;
    await send(DUNG, I(dungHa), "họp nội bộ");
    await send(VY, P(vyHa), "chào Hà"); // mới hơn
    const p1 = await call<ConvPage>(HA, "GET", `${MSG}/conversations?unread=true&limit=1`);
    expect(p1.body.items.map((c) => [c.id, c.kind])).toEqual([[vyHa, "partner"]]);
    expect(p1.body.next_cursor).not.toBeNull();
    const p2 = await call<ConvPage>(
      HA,
      "GET",
      `${MSG}/conversations?unread=true&limit=1&cursor=${p1.body.next_cursor}`,
    );
    expect(p2.body.items.map((c) => c.id)).toEqual([dungHa]);
    expect(p2.body.next_cursor).toBeNull();
    const co = await call<ConvPage>(HA, "GET", `${MSG}/conversations?unread=true&company=${A}`);
    expect(co.body.items.map((c) => c.id)).toEqual([vyHa]);
    const own = await call<ConvPage>(HA, "GET", `${MSG}/conversations?unread=true&company=own`);
    expect(own.body.items.map((c) => c.id)).toEqual([dungHa]);
    expect(
      (await call<ConvPage>(VY, "GET", `${MSG}/conversations?unread=true`)).body.items.length,
    ).toBe(0);
    for (const u of [DUNG, CUONG]) {
      const r = await call<ConvPage>(u, "GET", `${MSG}/conversations?unread=true`);
      expect(r.body.items.map((c) => c.id).includes(vyHa)).toBe(false);
    }
    await call(HA, "POST", `${P(vyHa)}/read`, { seq: 1 });
    const after = await call<ConvPage>(HA, "GET", `${MSG}/conversations?unread=true&company=${A}`);
    expect(after.body.items.length).toBe(0);
  });
});

type Att = {
  items: {
    file: { id: string; name: string; mime: string };
    kind: string;
    sender_name: string;
    seq: number;
  }[];
  next_cursor: string | null;
};
const seqs = (r: Res<Att>) => r.body.items.map((i) => i.seq);

describe("CR-178 M4 · Ảnh & tệp của cuộc nội bộ", () => {
  let g = "";
  it("người được giao (VY, không phải người tạo) liệt kê tệp đã gửi mới nhất trước; tệp chưa gửi và tệp của tin đã thu hồi không ra; lọc kind; phân trang keyset", async () => {
    g = (await group(TIEN, "Hồ sơ thầu", [VY])).body.id;
    const [p1, d1, p2, p3, orphan] = await Promise.all([
      upload(TIEN, I(g), "a1.png", PNG),
      upload(TIEN, I(g), "b.pdf", PDF),
      upload(TIEN, I(g), "a2.png", PNG),
      upload(TIEN, I(g), "a3.png", PNG),
      upload(TIEN, I(g), "chua-gui.png", PNG),
    ]);
    expect(orphan.status).toBe(201);
    await send(TIEN, I(g), "ảnh 1", [p1.body.id]); // seq 1
    await send(TIEN, I(g), "tài liệu", [d1.body.id]); // seq 2
    await send(TIEN, I(g), "ảnh 2", [p2.body.id]); // seq 3
    const s4 = await send(TIEN, I(g), "ảnh nhầm", [p3.body.id]); // seq 4, thu hồi
    await call(TIEN, "DELETE", `${I(g)}/messages/${s4.body.seq}`);
    const all = await call<Att>(VY, "GET", `${I(g)}/attachments`);
    expect([all.status, seqs(all)]).toEqual([200, [3, 2, 1]]);
    expect(all.body.items.map((i) => [i.file.name, i.kind, i.sender_name])).toEqual([
      ["a2.png", "image", "Tiến"],
      ["b.pdf", "file", "Tiến"],
      ["a1.png", "image", "Tiến"],
    ]);
    expect(seqs(await call<Att>(VY, "GET", `${I(g)}/attachments?kind=image`))).toEqual([3, 1]);
    expect(seqs(await call<Att>(VY, "GET", `${I(g)}/attachments?kind=file`))).toEqual([2]);
    const pg1 = await call<Att>(VY, "GET", `${I(g)}/attachments?limit=2`);
    expect([seqs(pg1), pg1.body.next_cursor !== null]).toEqual([[3, 2], true]);
    const pg2 = await call<Att>(
      VY,
      "GET",
      `${I(g)}/attachments?limit=2&cursor=${pg1.body.next_cursor}`,
    );
    expect([seqs(pg2), pg2.body.next_cursor]).toEqual([[1], null]);
    expect((await call<Att>(TIEN, "GET", `${I(g)}/attachments`)).status).toBe(200);
  });
  it("người ngoài cuộc cùng công ty (LAN), công ty khác (CUONG), id lạ ⇒ 404 MSG_NOT_FOUND; query sai ⇒ 400", async () => {
    for (const [u, id] of [
      [LAN, g],
      [ANH, g],
      [CUONG, g],
      [DUNG, g],
      [VY, randomUUID()],
    ] as const) {
      const r = await call(u, "GET", `${I(id)}/attachments`);
      expect([u, r.status, code(r)]).toEqual([u, 404, "MSG_NOT_FOUND"]);
    }
    for (const qs of ["kind=svg", "cursor=%25%25", "limit=31", "limit=0"]) {
      const r = await call(VY, "GET", `${I(g)}/attachments?${qs}`);
      expect([qs, r.status, code(r)]).toEqual([qs, 400, "VALIDATION_ERROR"]);
    }
  });
});

describe("CR-178 M4 · Ảnh & tệp của cuộc partner (đọc được cả sau ngắt kết nối)", () => {
  let vc = "";
  it("hai đầu (VY, CUONG — CUONG không phải người mở) thấy tệp của cả hai phía; công ty thứ ba (DUNG, B không kết nối C) và đồng nghiệp ngoài cuộc (LAN) ⇒ 404", async () => {
    vc = (await partner(VY, C, CUONG)).body.id;
    const [a, b, c] = await Promise.all([
      upload(VY, P(vc), "vy.png", PNG),
      upload(CUONG, P(vc), "cuong.pdf", PDF),
      upload(VY, P(vc), "nham.png", PNG),
    ]);
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    await send(VY, P(vc), "ảnh Vy", [a.body.id]); // 1
    await send(CUONG, P(vc), "pdf Cường", [b.body.id]); // 2
    const s3 = await send(VY, P(vc), "ảnh nhầm", [c.body.id]); // 3, thu hồi
    await call(VY, "DELETE", `${P(vc)}/messages/${s3.body.seq}`);
    const r = await call<Att>(CUONG, "GET", `${P(vc)}/attachments`);
    expect([r.status, seqs(r)]).toEqual([200, [2, 1]]);
    expect(r.body.items.map((i) => [i.file.name, i.kind, i.sender_name])).toEqual([
      ["cuong.pdf", "file", "Cuong"],
      ["vy.png", "image", "Vy"],
    ]);
    expect(seqs(await call<Att>(VY, "GET", `${P(vc)}/attachments?kind=image`))).toEqual([1]);
    const pg1 = await call<Att>(VY, "GET", `${P(vc)}/attachments?limit=1`);
    const pg2 = await call<Att>(
      VY,
      "GET",
      `${P(vc)}/attachments?limit=1&cursor=${pg1.body.next_cursor}`,
    );
    expect([seqs(pg1), seqs(pg2), pg2.body.next_cursor]).toEqual([[2], [1], null]);
    for (const u of [DUNG, HA, LAN, TIEN]) {
      const x = await call(u, "GET", `${P(vc)}/attachments`);
      expect([u, x.status, code(x)]).toEqual([u, 404, "MSG_NOT_FOUND"]);
    }
    expect((await call(VY, "GET", `${P(vc)}/attachments?kind=svg`)).status).toBe(400);
  });
  it("sau khi ngắt kết nối A–C vẫn liệt kê được (P3)", async () => {
    await o`delete from hub.partner_links where (from_tenant, to_tenant) in ((${A}, ${C}), (${C}, ${A}))`;
    expect(seqs(await call<Att>(CUONG, "GET", `${P(vc)}/attachments`))).toEqual([2, 1]);
    expect(seqs(await call<Att>(VY, "GET", `${P(vc)}/attachments`))).toEqual([2, 1]);
  });
});

// M3 được thêm bên dưới.
export const _used = { ANH, HA };
