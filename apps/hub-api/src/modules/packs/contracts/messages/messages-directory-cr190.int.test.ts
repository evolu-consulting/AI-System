// CR-190 · danh bạ nhóm trang Tin nhắn `GET /messages/directory`: route thật (Hono + pool `hub_api` + role `contracts_rw` + RLS + hàm hub 0167). Mỗi nhóm phải đúng TẬP luật HIỆN TẠI cho nhắn
// (so với `/messages/people` cũ), không có người ngoài luật, kể cả người chưa từng nhắn. A (nội bộ, 20+ người) · B «Bắc Á» và C «Công ty Cờ» (kết nối A) · E (kết nối A, 20 người) · D (KHÔNG kết nối).
// N2: VY (được giao, KHÔNG phải người tạo TIEN) thấy nhóm chat TIEN tạo; ghim/cờ của VY không lộ sang TIEN; LAN (ngoài nhóm) không thấy nhóm đó.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  type MsgDirectoryResponse,
  MsgDirectoryResponseSchema,
  type MsgDirGroup,
} from "@ai/contracts/pack-contracts";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../../lib/db";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/public";
import { messagesModule } from "./messages.mount";

const A = tenantId(1810);
const B = tenantId(1811);
const C = tenantId(1812);
const D = tenantId(1813);
const E = tenantId(1814);
const TIEN = userId(1810); // A · người tạo nhóm chat
const VY = userId(1811); // A · được giao (thành viên), không phải người tạo
const LAN = userId(1812); // A · cùng công ty, ngoài nhóm chat
const NGHI = userId(1813); // A · đã nghỉ (không được nhắn)
const HA = userId(1820); // B
const DUNG = userId(1821); // B
const BO = userId(1822); // B · KHÔNG có quyền Sổ Hợp Tác ⇒ không đủ điều kiện
const NGHI_B = userId(1823); // B · đã nghỉ
const CUA = userId(1830); // C
const CON = userId(1831); // C
const EVE = userId(1840); // D · công ty KHÔNG kết nối
const E0 = 1900; // E · 20 người từ userId(1900)
const A_EXTRA = 1950; // A · thêm 18 đồng nghiệp (userId(1950..1967))
const F = { read: "f-r", write: "f-w", admin: "f-a" };
const ALL = [A, B, C, D, E];
let o: Sql;
let db: Db;
let who: Map<string, { tenant: string; group: string }>;
let grp: Map<string, Record<"owner" | "editor" | "viewer", string>>;

function view(): PackAccessView {
  return {
    catalog: async () => ({
      features: [
        { id: F.read, key: "contracts-read", status: "on" },
        { id: F.write, key: "contracts-write", status: "on" },
        { id: F.admin, key: "contracts-admin", status: "on" },
      ],
      entitled: new Set(ALL.flatMap((t) => Object.values(F).map((f) => `${t}:${f}`))),
      grantGroups: new Map(
        ALL.flatMap((t) => {
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
const MSG = "/messages";
const P = (id: string) => `${MSG}/partner/${id}`;
const I = (id: string) => `${MSG}/conversations/${id}`;
const send = (user: string, base: string, body: string) =>
  call<{ seq: number }>(user, "POST", `${base}/messages`, {
    client_id: randomUUID(),
    body,
    file_ids: [],
  });
const openPartner = async (user: string, tenant: string, peer: string) =>
  (
    await call<{ id: string }>(user, "POST", `${MSG}/conversations`, {
      kind: "partner",
      tenant_id: tenant,
      user_id: peer,
    })
  ).body.id;
const openDm = async (user: string, peer: string) =>
  (
    await call<{ id: string }>(user, "POST", `${MSG}/conversations`, {
      kind: "direct",
      user_id: peer,
    })
  ).body.id;
const dir = async (user: string, qs = ""): Promise<MsgDirectoryResponse> => {
  const r = await call(user, "GET", `${MSG}/directory${qs}`);
  expect(r.status).toBe(200);
  return MsgDirectoryResponseSchema.parse(r.body);
};
const grpOf = (r: MsgDirectoryResponse, key: string): MsgDirGroup => {
  const g = r.groups.find((x) => x.key === key);
  if (!g) throw new Error(`thiếu nhóm ${key}: ${r.groups.map((x) => x.key).join(",")}`);
  return g;
};
const personIds = (g: MsgDirGroup) => g.items.flatMap((i) => (i.person ? [i.person.id] : []));
/** Mọi người của một nhóm công ty theo luật CŨ (`/messages/people?company=…` phân trang hết). */
async function oldPeople(user: string, company: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  do {
    const r = await call<{ items: { id: string }[]; next_cursor: string | null }>(
      user,
      "GET",
      `${MSG}/people?company=${company}&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
    );
    out.push(...r.body.items.map((x) => x.id));
    cursor = r.body.next_cursor ?? undefined;
  } while (cursor);
  return out;
}
const total = async (user: string) =>
  (await call<{ total: number }>(user, "GET", `${MSG}/unread`)).body.total;

let gTien = "";
let gRong = "";
const KEY_B = `partner:${B}`;
const KEY_C = `partner:${C}`;
const KEY_E = `partner:${E}`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed) values
    (${A}, 'd190-a', 'A', 'Nơi Làm Việc', '0100001810', true), (${B}, 'd190-b', 'B', 'Bắc Á', '0100001811', true),
    (${C}, 'd190-c', 'C', 'Công ty Cờ', '0100001812', true), (${D}, 'd190-d', 'D', 'Đông Dương', '0100001813', true),
    (${E}, 'd190-e', 'E', 'Em Em', '0100001814', true)`;
  await users(o, A, 4, { from: 1810 });
  await users(o, A, 18, { from: A_EXTRA });
  await users(o, B, 4, { from: 1820 });
  await users(o, C, 2, { from: 1830 });
  await users(o, D, 1, { from: 1840 });
  await users(o, E, 20, { from: E0 });
  grp = await enablePack(o, ALL, "contracts");
  const g = (t: string, r: "owner" | "editor" | "viewer") => grp.get(t)?.[r] as string;
  await members(o, A, g(A, "owner"), [TIEN]);
  await members(o, A, g(A, "editor"), [VY]);
  await members(o, A, g(A, "viewer"), [
    LAN,
    NGHI,
    ...Array.from({ length: 18 }, (_, k) => userId(A_EXTRA + k)),
  ]);
  await members(o, B, g(B, "owner"), [DUNG]);
  await members(o, B, g(B, "viewer"), [HA, NGHI_B]); // BO không vào nhóm quyền nào
  await members(o, C, g(C, "viewer"), [CUA, CON]);
  await members(o, D, g(D, "viewer"), [EVE]);
  await members(
    o,
    E,
    g(E, "viewer"),
    Array.from({ length: 20 }, (_, k) => userId(E0 + k)),
  );
  who = new Map<string, { tenant: string; group: string }>([
    [TIEN, { tenant: A, group: g(A, "owner") }],
    [VY, { tenant: A, group: g(A, "editor") }],
    [LAN, { tenant: A, group: g(A, "viewer") }],
    [HA, { tenant: B, group: g(B, "viewer") }],
    [DUNG, { tenant: B, group: g(B, "owner") }],
  ]);
  for (const [id, n] of [
    [TIEN, "Tiến"],
    [VY, "Vy"],
    [LAN, "Lan"],
    [NGHI, "Nghỉ A"],
    [HA, "Hà"],
    [DUNG, "Dũng"],
    [BO, "Bo"],
    [NGHI_B, "Nghỉ B"],
    [CUA, "Của"],
    [CON, "Con"],
    [EVE, "Eve"],
  ] as [string, string][])
    await o`update admin.users set display_name = ${n} where id = ${id}`;
  await o`update admin.users set active = false where id in (${NGHI}, ${NGHI_B})`;
  await o`update admin.users u set display_name = 'Em ' || lpad(x.i::text, 2, '0')
    from (select id, row_number() over (order by id) as i from admin.users where tenant_id = ${E}) x where u.id = x.id`;
  await o`update admin.users u set display_name = 'Đồng ' || lpad(x.i::text, 2, '0')
    from (select id, row_number() over (order by id) as i from admin.users where id >= ${userId(A_EXTRA)} and tenant_id = ${A}) x where u.id = x.id`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    values (${A}, ${B}, now()), (${B}, ${A}, now()), (${A}, ${C}, now()), (${C}, ${A}, now()), (${A}, ${E}, now()), (${E}, ${A}, now())`;
  gTien = (
    await call<{ id: string }>(TIEN, "POST", `${MSG}/conversations`, {
      kind: "group",
      title: "Báo giá Q1",
      member_ids: [VY],
    })
  ).body.id;
  gRong = (
    await call<{ id: string }>(TIEN, "POST", `${MSG}/conversations`, {
      kind: "group",
      title: "Ăn trưa",
      member_ids: [VY],
    })
  ).body.id;
  await send(TIEN, I(gTien), "đơn hàng 1");
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-190 · danh bạ nhóm — đúng tập luật hiện tại, kể cả chưa từng nhắn", () => {
  it("thứ tự nhóm cố định (công ty A→Z, Nhóm chat, Nội bộ), đầu nhóm có tổng người + chưa đọc, đúng contract", async () => {
    const r = await dir(VY);
    expect(r.groups.map((g) => g.key)).toEqual([KEY_B, KEY_C, KEY_E, "chat", "internal"]);
    expect(r.groups.map((g) => g.kind)).toEqual([
      "partner",
      "partner",
      "partner",
      "chat",
      "internal",
    ]);
    expect(grpOf(r, KEY_B).company).toEqual({ id: B, name: "Bắc Á" });
    expect(grpOf(r, KEY_B).total).toBe(2);
    expect(grpOf(r, KEY_C).total).toBe(2);
    expect(grpOf(r, KEY_E).total).toBe(20);
    expect(grpOf(r, "chat").total).toBe(2);
    expect(r.groups.every((g) => g.unread === 0 || g.key === "chat")).toBe(true);
  });

  it("nhóm công ty = đúng tập `/messages/people` cũ (người ngoài luật không có: không quyền, đã nghỉ, công ty không kết nối), người chưa từng nhắn có `conversation: null`", async () => {
    const r = await dir(VY);
    for (const [key, company] of [
      [KEY_B, B],
      [KEY_C, C],
    ] as const) {
      const g = grpOf(r, key);
      expect(personIds(g).sort()).toEqual((await oldPeople(VY, company)).sort());
      expect(g.items.every((i) => i.conversation === null && i.person?.active === true)).toBe(true);
    }
    const all = r.groups.flatMap(personIds);
    for (const bad of [BO, NGHI_B, EVE, NGHI, VY]) expect(all).not.toContain(bad);
    // người chưa từng nhắn: theo tên A→Z (Dũng < Hà)
    expect(personIds(grpOf(r, KEY_B))).toEqual([DUNG, HA]);
    expect(grpOf(r, "chat").items.map((i) => i.conversation?.title)).toEqual([
      "Báo giá Q1",
      "Ăn trưa",
    ]);
  });

  it("nhóm «Nội bộ» = đúng tập `/messages/people?company=own` cũ (đồng nghiệp còn dùng được, trừ chính mình và người đã nghỉ), N2: VY thấy nhóm chat TIEN tạo, LAN thì không", async () => {
    const old: string[] = [];
    let cursor: string | undefined;
    do {
      const p = await call<{ items: { id: string }[]; next_cursor: string | null }>(
        VY,
        "GET",
        `${MSG}/people?company=own&limit=50${cursor ? `&cursor=${cursor}` : ""}`,
      );
      old.push(...p.body.items.map((x) => x.id));
      cursor = p.body.next_cursor ?? undefined;
    } while (cursor);
    const all: string[] = [];
    let cur: string | undefined;
    do {
      const r = await dir(VY, `?group=internal&limit=50${cur ? `&cursor=${cur}` : ""}`);
      const g = grpOf(r, "internal");
      all.push(...personIds(g));
      cur = g.next_cursor ?? undefined;
    } while (cur);
    expect(all.sort()).toEqual(old.sort());
    expect(all).not.toContain(NGHI);
    expect(all).not.toContain(VY);
    expect(all).toHaveLength(20); // TIEN, LAN + 18
    expect(grpOf(await dir(LAN), "chat").total).toBe(0);
    expect(grpOf(await dir(TIEN), "chat").total).toBe(2);
  });

  it("15 dòng đầu + trang tiếp theo nhóm, không trùng, giữ thứ tự tên A→Z, hết thì `next_cursor` null", async () => {
    const first = grpOf(await dir(VY), KEY_E);
    expect(first.items).toHaveLength(15);
    expect(first.next_cursor).not.toBeNull();
    expect(first.total).toBe(20);
    const second = grpOf(await dir(VY, `?group=${KEY_E}&cursor=${first.next_cursor}`), KEY_E);
    expect(second.items).toHaveLength(5);
    expect(second.next_cursor).toBeNull();
    const names = [...first.items, ...second.items].map((i) => i.person?.name);
    expect(new Set(names).size).toBe(20);
    expect(names).toEqual([...names].sort());
    // chỉ trả đúng nhóm được hỏi
    expect((await dir(VY, `?group=${KEY_E}&cursor=${first.next_cursor}`)).groups).toHaveLength(1);
    // nội bộ cũng 15 + «Xem thêm» (20 người ⇒ 15 + 5)
    const inn = grpOf(await dir(VY), "internal");
    expect([inn.items.length, inn.total, inn.next_cursor === null]).toEqual([15, 20, false]);
  });

  it("con trỏ hỏng hoặc có con trỏ mà không có nhóm ⇒ 400", async () => {
    const bad = await call(VY, "GET", `${MSG}/directory?group=chat&cursor=xxx`);
    expect(bad.status).toBe(400);
    const lone = await call(
      VY,
      "GET",
      `${MSG}/directory?cursor=${grpOf(await dir(VY), KEY_E).next_cursor}`,
    );
    expect(lone.status).toBe(400);
    expect((await call(VY, "GET", `${MSG}/directory?group=nope`)).status).toBe(400);
  });
});

describe("CR-190 · danh bạ nhóm — sắp xếp, ghim, chưa đọc", () => {
  let toHa = "";
  let toDung = "";
  it("đã nhắn lên trước, chưa từng nhắn sau (theo tên), tin mới nhất lên đầu", async () => {
    toDung = await openPartner(VY, B, DUNG);
    await send(VY, P(toDung), "chào Dũng");
    toHa = await openPartner(VY, B, HA);
    await send(VY, P(toHa), "chào Hà");
    const g = grpOf(await dir(VY), KEY_B);
    expect(personIds(g)).toEqual([HA, DUNG]); // Hà nhắn sau ⇒ mới nhất
    expect(g.items[0]?.conversation?.last_message?.preview).toBe("chào Hà");
    // cùng nhóm C: chưa nhắn ai ⇒ theo tên (Con < Của)
    expect(personIds(grpOf(await dir(VY), KEY_C))).toEqual([CON, CUA]);
  });

  it("ghim lên đầu nhóm (kể cả cuộc cũ hơn), chỉ VY thấy ghim của VY — TIEN (người tạo nhóm chat) không thấy", async () => {
    await call(VY, "PUT", `${P(toDung)}/pin`, { pinned: true });
    expect(personIds(grpOf(await dir(VY), KEY_B))).toEqual([DUNG, HA]);
    expect(grpOf(await dir(VY), KEY_B).items[0]?.conversation?.pinned_at).not.toBeNull();
    // nhóm chat: VY ghim «Ăn trưa» (rỗng) ⇒ lên đầu dù «Báo giá Q1» có tin
    await call(VY, "PUT", `${I(gRong)}/pin`, { pinned: true });
    expect(grpOf(await dir(VY), "chat").items.map((i) => i.conversation?.title)).toEqual([
      "Ăn trưa",
      "Báo giá Q1",
    ]);
    expect(grpOf(await dir(TIEN), "chat").items.map((i) => i.conversation?.title)).toEqual([
      "Báo giá Q1",
      "Ăn trưa",
    ]);
    expect(
      grpOf(await dir(TIEN), "chat").items.every((i) => i.conversation?.pinned_at === null),
    ).toBe(true);
  });

  it("1-1 nội bộ: người đã nhắn lên trước người chưa nhắn, ghim đưa lên đầu, người đã nghỉ có lịch sử vẫn thấy", async () => {
    const dm = await openDm(VY, LAN);
    await send(VY, I(dm), "chào Lan");
    const a = grpOf(await dir(VY), "internal").items;
    expect(a[0]?.person?.id).toBe(LAN);
    expect(a[0]?.conversation?.last_message?.preview).toBe("chào Lan");
    expect(a[1]?.conversation).toBeNull();
    // người đã nghỉ có cuộc với lịch sử: vẫn thấy (active=false), người nghỉ không có cuộc thì không
    await o`update admin.users set active = true where id = ${NGHI}`;
    const dm2 = await openDm(TIEN, NGHI);
    await send(TIEN, I(dm2), "tạm biệt");
    await o`update admin.users set active = false where id = ${NGHI}`;
    const t = grpOf(await dir(TIEN), "internal").items.find((i) => i.person?.id === NGHI);
    expect(t?.person?.active).toBe(false);
    expect(t?.conversation?.peer?.name).toBe("Nghỉ A");
  });

  it("chưa đọc đầu nhóm = Σ max(thật, cờ) mỗi cuộc, tổng các nhóm khớp `GET /messages/unread`", async () => {
    await send(HA, P(toHa), "Hà trả lời"); // 1 chưa đọc thật ở nhóm B (VY) — Hà là người gửi
    await send(HA, P(toHa), "Hà gửi thêm"); // 2
    const cuaCuoc = await openPartner(VY, C, CUA);
    await send(VY, P(cuaCuoc), "chào Của");
    await call(VY, "POST", `${P(cuaCuoc)}/read`, { seq: 1 });
    await call(VY, "PUT", `${P(cuaCuoc)}/mark-unread`, { unread: true }); // chỉ cờ ⇒ 1
    await call(VY, "PUT", `${P(toHa)}/mark-unread`, { unread: true }); // cờ + 2 chưa đọc thật ⇒ vẫn 2 (không 3)
    const r = await dir(VY);
    expect(grpOf(r, KEY_B).unread).toBe(2);
    expect(grpOf(r, KEY_C).unread).toBe(1);
    expect(grpOf(r, KEY_C).items.find((i) => i.person?.id === CUA)?.conversation?.unread).toBe(1);
    expect(grpOf(r, KEY_B).items.find((i) => i.person?.id === HA)?.conversation?.unread).toBe(2);
    const sum = r.groups.reduce((n, g) => n + g.unread, 0);
    expect(sum).toBe(await total(VY));
    // người khác (TIEN, cùng công ty) không có cờ/chưa đọc của VY ở nhóm đối tác
    expect(grpOf(await dir(TIEN), KEY_B).unread).toBe(0);
  });
});

describe("CR-190 · danh bạ nhóm — tìm kiếm", () => {
  it("tìm theo tên công ty ⇒ chỉ nhóm đó, đủ người, theo người ⇒ chỉ dòng khớp, không dấu/hoa thường, không khớp ⇒ không nhóm", async () => {
    const byCompany = await dir(VY, `?q=${encodeURIComponent("bac a")}`);
    expect(byCompany.groups.map((g) => g.key)).toEqual([KEY_B]);
    expect(byCompany.groups[0]?.total).toBe(2);
    const byPerson = await dir(VY, `?q=${encodeURIComponent("DUNG")}`);
    expect(byPerson.groups.map((g) => g.key)).toEqual([KEY_B]);
    expect(personIds(byPerson.groups[0] as MsgDirGroup)).toEqual([DUNG]);
    const chat = await dir(VY, `?q=${encodeURIComponent("bao gia")}`);
    expect(chat.groups.map((g) => g.key)).toEqual(["chat"]);
    expect((await dir(VY, `?q=${encodeURIComponent("zzzz-khong-co")}`)).groups).toEqual([]);
    // người ngoài luật không thể tìm ra: Eve (công ty không kết nối), Bo (không quyền)
    expect((await dir(VY, "?q=eve")).groups).toEqual([]);
    expect((await dir(VY, "?q=bo")).groups.flatMap(personIds)).not.toContain(BO);
  });
});
