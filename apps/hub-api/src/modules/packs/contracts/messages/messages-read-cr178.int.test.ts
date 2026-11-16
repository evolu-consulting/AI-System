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
    await send(TIEN, I(g1), "đơn hàng 1"); // VY chưa đọc
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

type Hit = {
  conversation_id: string;
  kind: string;
  title: string;
  company: { id: string; name: string } | null;
  seq: number;
  sender_name: string;
  snippet: string;
  match: { start: number; end: number } | null;
};
type Found = { items: Hit[]; next_cursor: string | null };
const SEARCH = `${MSG}/search`;
const find = (user: string, q: string, extra = "") =>
  call<Found>(user, "GET", `${SEARCH}?q=${encodeURIComponent(q)}${extra}`);
/** `kind:seq` mỗi kết quả. */
const ks = (r: Res<Found>) => r.body.items.map((h) => `${h.kind}:${h.seq}`);
/** `cuộc#seq` mỗi kết quả. */
const cs = (r: Res<Found>) => r.body.items.map((h) => `${h.conversation_id}#${h.seq}`);

describe("CR-178 M3 · tìm tin (không phân biệt hoa/dấu, đúng người xem, keyset)", () => {
  let gs = "";
  let gt = "";
  let dm = "";
  let pv = "";
  it("«bao gia» ra «báo giá»: người được giao (VY) thấy nội bộ + partner mới nhất trước; tin thu hồi và cuộc không là thành viên không ra", async () => {
    await o`update admin.users set display_name = 'Lan' where id = ${LAN}`;
    gs = (await group(TIEN, "Báo giá Q4", [VY])).body.id;
    gt = (await group(TIEN, "Riêng Tiến-Anh", [ANH])).body.id;
    await send(TIEN, I(gs), "Báo giá đợt 1 đã gửi"); // gs 1
    await send(VY, I(gs), "ok em đã nhận BÁO GIÁ"); // gs 2
    await send(TIEN, I(gs), "Cảm ơn 100% nhé"); // gs 3
    const r4 = await send(TIEN, I(gs), "gửi nhầm báo giá"); // gs 4 — thu hồi
    await call(TIEN, "DELETE", `${I(gs)}/messages/${r4.body.seq}`);
    await send(TIEN, I(gs), "Đặng Văn phụ trách"); // gs 5
    await send(TIEN, I(gt), "báo giá cho Anh"); // gt 1 — VY không là thành viên
    dm = (
      await call<{ id: string }>(VY, "POST", `${MSG}/conversations`, {
        kind: "direct",
        user_id: LAN,
      })
    ).body.id;
    await send(VY, I(dm), "bao gia truoc ngay mai"); // dm 1
    pv = (await partner(VY, B, DUNG)).body.id;
    await send(VY, P(pv), "Báo giá hợp đồng B"); // pv 1
    await send(DUNG, P(pv), "đã nhận báo giá"); // pv 2
    const r = await find(VY, "bao gia");
    expect([r.status, ks(r), r.body.next_cursor]).toEqual([
      200,
      ["partner:2", "partner:1", "direct:1", "group:2", "group:1"],
      null,
    ]);
    const [p2, , d1, g2] = r.body.items;
    expect([p2?.title, p2?.company?.name, p2?.sender_name]).toEqual([
      "Dũng",
      "Preschool Việt",
      "Dũng",
    ]);
    expect([d1?.title, d1?.company, d1?.sender_name]).toEqual(["Lan", null, "Vy"]);
    expect([g2?.title, g2?.sender_name, g2?.snippet]).toEqual([
      "Báo giá Q4",
      "Vy",
      "ok em đã nhận BÁO GIÁ",
    ]);
    expect(g2?.snippet.slice(g2.match?.start, g2.match?.end)).toBe("BÁO GIÁ");
  });
  it("mỗi người chỉ thấy phần của mình: TIEN (người tạo) thấy gt + gs; LAN chỉ DM; ANH chỉ gt; DUNG chỉ partner; người thứ ba (HA), công ty thứ ba (CUONG) ⇒ rỗng", async () => {
    expect(cs(await find(TIEN, "BAO GIA"))).toEqual([`${gt}#1`, `${gs}#2`, `${gs}#1`]);
    expect(cs(await find(LAN, "bao gia"))).toEqual([`${dm}#1`]);
    expect(cs(await find(ANH, "bao gia"))).toEqual([`${gt}#1`]);
    expect(cs(await find(DUNG, "bao gia"))).toEqual([`${pv}#2`, `${pv}#1`]);
    for (const u of [HA, CUONG]) expect([u, ks(await find(u, "bao gia"))]).toEqual([u, []]);
  });
  it("phân trang keyset limit=2 nối lại đúng danh sách đầy đủ", async () => {
    const full = cs(await find(VY, "bao gia"));
    const got: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const r: Res<Found> = await find(
        VY,
        "bao gia",
        `&limit=2${cursor ? `&cursor=${cursor}` : ""}`,
      );
      got.push(...cs(r));
      cursor = r.body.next_cursor;
      if (!cursor) break;
    }
    expect([got, cursor]).toEqual([full, null]);
    expect(full.length).toBe(5);
  });
  it("conversation_id: chỉ tìm trong cuộc đó; cuộc không thấy (gt với VY, partner với HA) ⇒ rỗng, không lỗi", async () => {
    expect(cs(await find(VY, "bao gia", `&conversation_id=${gs}`))).toEqual([`${gs}#2`, `${gs}#1`]);
    expect(cs(await find(VY, "bao gia", `&conversation_id=${pv}`))).toEqual([`${pv}#2`, `${pv}#1`]);
    for (const [u, c] of [
      [VY, gt],
      [HA, pv],
      [LAN, gs],
      [CUONG, pv],
      [VY, randomUUID()],
    ] as const) {
      const r = await find(u, "bao gia", `&conversation_id=${c}`);
      expect([u, r.status, ks(r)]).toEqual([u, 200, []]);
    }
  });
  it("khớp chứa chuỗi, đ→d, ký tự % _ là chữ thường (không là ký tự đại diện)", async () => {
    expect(ks(await find(TIEN, "dang van"))).toEqual(["group:5"]);
    expect(ks(await find(TIEN, "100%"))).toEqual(["group:3"]);
    expect(ks(await find(TIEN, "1%0"))).toEqual([]);
    expect(ks(await find(TIEN, "1_0"))).toEqual([]);
    expect(ks(await find(TIEN, "gui nham"))).toEqual([]); // tin đã thu hồi không ra
  });
  it("query sai ⇒ 400: thiếu q, 1 ký tự, > 100 ký tự, limit > 20, cursor hỏng, conversation_id không phải uuid", async () => {
    for (const qs of [
      "",
      "q=a",
      `q=${"x".repeat(101)}`,
      "q=bao&limit=21",
      "q=bao&cursor=%25%25",
      "q=bao&conversation_id=abc",
    ]) {
      const r = await call(VY, "GET", `${SEARCH}?${qs}`);
      expect([qs.slice(0, 20), r.status, code(r)]).toEqual([
        qs.slice(0, 20),
        400,
        "VALIDATION_ERROR",
      ]);
    }
  });
  it("tin partner bị thu hồi không ra; sau khi ngắt kết nối A–B hai đầu vẫn tìm được (P3), người thứ ba vẫn không", async () => {
    const r3 = await send(DUNG, P(pv), "báo giá nhầm của Hà"); // pv 3
    expect(ks(await find(VY, "bao gia", `&conversation_id=${pv}`))).toContain("partner:3");
    await call(DUNG, "DELETE", `${P(pv)}/messages/${r3.body.seq}`);
    expect(ks(await find(VY, "bao gia", `&conversation_id=${pv}`))).toEqual([
      "partner:2",
      "partner:1",
    ]);
    await o`delete from hub.partner_links where (from_tenant, to_tenant) in ((${A}, ${B}), (${B}, ${A}))`;
    expect(cs(await find(DUNG, "bao gia"))).toEqual([`${pv}#2`, `${pv}#1`]);
    expect(cs(await find(VY, "bao gia", `&conversation_id=${pv}`))).toEqual([`${pv}#2`, `${pv}#1`]);
    expect(ks(await find(HA, "bao gia"))).toEqual([]);
  });
  it("around_seq: trang quanh một tin (nội bộ + partner), có has_newer; không có around thì giữ nguyên hành vi cũ", async () => {
    const gc = (await group(TIEN, "Dài", [VY])).body.id;
    for (let i = 1; i <= 12; i++) await send(TIEN, I(gc), `tin ${i}`);
    type Pg = { items: { seq: number }[]; has_more: boolean; has_newer?: boolean };
    const at = async (qs: string) => (await call<Pg>(VY, "GET", `${I(gc)}/messages?${qs}`)).body;
    const mid = await at("around_seq=6&limit=6");
    expect([mid.items.map((m) => m.seq), mid.has_more, mid.has_newer]).toEqual([
      [4, 5, 6, 7, 8, 9],
      true,
      true,
    ]);
    const head = await at("around_seq=1&limit=6");
    expect([head.items.map((m) => m.seq), head.has_more, head.has_newer]).toEqual([
      [1, 2, 3, 4],
      false,
      true,
    ]);
    const tail = await at("around_seq=12&limit=6");
    expect([tail.items.map((m) => m.seq), tail.has_more, tail.has_newer]).toEqual([
      [7, 8, 9, 10, 11, 12],
      true,
      false,
    ]);
    const old = await at("limit=3");
    expect([old.items.map((m) => m.seq), old.has_more, "has_newer" in old]).toEqual([
      [10, 11, 12],
      true,
      false,
    ]);
    const pp = (await call<Pg>(DUNG, "GET", `${P(pv)}/messages?around_seq=1&limit=2`)).body;
    expect([pp.items.map((m) => m.seq), pp.has_more, pp.has_newer]).toEqual([[1, 2], false, true]);
    const out = await call(LAN, "GET", `${I(gc)}/messages?around_seq=6`);
    expect([out.status, code(out)]).toEqual([404, "MSG_NOT_FOUND"]);
  });
});
