// CR-169 · lát 3a · spec §3 (P1–P3, P8–P10, P12) · §4: route `/pack/contracts/messages/{conversations,unread,people,companies}` thật (Hono + pool `hub_api` + role `contracts_rw` + RLS).
// Công ty: A (NitiGroup) — B (Preschool) và A — C đã kết nối; B và C KHÔNG kết nối (C là công ty thứ ba của cuộc A–B); E không quan hệ.
// N2: Vy (nhân viên A, không phải người mời) mở cuộc với Hà (nhân viên B, không phải người đồng ý). Người không có quyền Sổ Hợp Tác / external ⇒ 403.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  ConversationDetailSchema,
  ConversationPageSchema,
  MsgCompanyPageSchema,
  MsgPeoplePageSchema,
} from "@ai/contracts/pack-contracts";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inHub, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../../lib/db";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/public";
import { messagesModule } from "./messages.mount";

const A = tenantId(1695);
const B = tenantId(1696);
const C = tenantId(1697);
const E = tenantId(1698);
const TIEN = userId(1695); // A · Toàn quyền
const VY = userId(1696); // A · nhân viên (editor)
const LAN = userId(1697); // A · nhân viên (viewer), ngoài cuộc Vy–Hà
const NOGRANT = userId(1698); // A · KHÔNG có quyền Sổ Hợp Tác
const DUNG = userId(1699); // B · Toàn quyền
const HA = userId(1700); // B · nhân viên (viewer)
const EXT = userId(1701); // B · external
const CUONG = userId(1702); // C · Toàn quyền
const EVA = userId(1703); // E · Toàn quyền
const ORG = "a1695000-0000-4000-8000-000000000001";
const F = { read: "f-r", write: "f-w", admin: "f-a" };
let o: Sql;
let db: Db;
let who: Map<string, { tenant: string; group: string; kind: "internal" | "external" }>;
let grp: Map<string, Record<"owner" | "editor" | "viewer", string>>;

function view(): PackAccessView {
  const all = [A, B, C, E];
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
      userKind: w?.kind,
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
  return { status: r.status, body: (await r.json()) as T };
};
const code = (r: Res) => (r.body as { error?: { code?: string } }).error?.code;
const as = <T>(t: string, u: string, fn: (tx: Sql) => Promise<T>) =>
  inHub({ kind: "user", tenantId: t, userId: u }, fn);
const MSG = "/messages";
const create = (user: string, tenant: string, peer: string) =>
  call<{ id: string }>(user, "POST", `${MSG}/conversations`, {
    kind: "partner",
    tenant_id: tenant,
    user_id: peer,
  });
const threads = () =>
  o`select count(*)::int as n from hub.pmsg_threads`.then((r) => r[0]?.n as number);
type Page = { items: { id: string; kind: string }[]; next_cursor: string | null };
const parsePeople = (r: Res) => MsgPeoplePageSchema.parse(r.body);
const parseCompanies = (r: Res) => MsgCompanyPageSchema.parse(r.body);

let vyHa = "";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'pa-a', 'A', 'NitiGroup', '0100000501', true), (${B}, 'pa-b', 'B', 'Preschool Việt', '0100000502', true),
           (${C}, 'pa-c', 'C', 'Công ty Cờ', '0100000503', true), (${E}, 'pa-e', 'E', 'Công ty Ê', '0100000504', true)`;
  await users(o, A, 4, { from: 1695 });
  await users(o, B, 2, { from: 1699 });
  await users(o, C, 1, { from: 1702 });
  await users(o, E, 1, { from: 1703 });
  await o`insert into admin.external_orgs (id, tenant_id, name) values (${ORG}, ${B}, 'NCC Ngoài')`;
  await o`insert into admin.users (id, tenant_id, username, password_hash, display_name, role, kind, external_org_id, must_change_password)
    values (${EXT}, ${B}, 'ncc-ext2', 'x', 'NCC', 'member', 'external', ${ORG}, false)`;
  grp = await enablePack(o, [A, B, C, E], "contracts");
  const g = (t: string, r: "owner" | "editor" | "viewer") => grp.get(t)?.[r] as string;
  await members(o, A, g(A, "owner"), [TIEN]);
  await members(o, A, g(A, "editor"), [VY]);
  await members(o, A, g(A, "viewer"), [LAN]);
  await members(o, B, g(B, "owner"), [DUNG]);
  await members(o, B, g(B, "viewer"), [HA]);
  await members(o, C, g(C, "owner"), [CUONG]);
  await members(o, E, g(E, "owner"), [EVA]);
  who = new Map([
    [TIEN, { tenant: A, group: g(A, "owner"), kind: "internal" }],
    [VY, { tenant: A, group: g(A, "editor"), kind: "internal" }],
    [LAN, { tenant: A, group: g(A, "viewer"), kind: "internal" }],
    [NOGRANT, { tenant: A, group: randomUUID(), kind: "internal" }],
    [DUNG, { tenant: B, group: g(B, "owner"), kind: "internal" }],
    [HA, { tenant: B, group: g(B, "viewer"), kind: "internal" }],
    [EXT, { tenant: B, group: g(B, "viewer"), kind: "external" }],
    [CUONG, { tenant: C, group: g(C, "owner"), kind: "internal" }],
    [EVA, { tenant: E, group: g(E, "owner"), kind: "internal" }],
  ]);
  await o`insert into hub.people_profiles (tenant_id, user_id, job_title) values (${B}, ${HA}, 'Kế toán trưởng')`;
  await o`update admin.users set display_name = 'Hà' where id = ${HA}`;
  await o`update admin.users set display_name = 'Vy' where id = ${VY}`;
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    values (${A}, ${B}, now()), (${B}, ${A}, now()), (${A}, ${C}, now()), (${C}, ${A}, now())`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-169 3a · quyền: không có quyền Sổ Hợp Tác / external ⇒ 403 ở mọi route", () => {
  it("NOGRANT (không nhóm) và external gọi list/unread/people/companies/tạo cuộc ⇒ 403 PACK_FORBIDDEN", async () => {
    const routes: [string, string, unknown?][] = [
      ["GET", `${MSG}/conversations`],
      ["GET", `${MSG}/unread`],
      ["GET", `${MSG}/people`],
      ["GET", `${MSG}/companies`],
      ["POST", `${MSG}/conversations`, { kind: "partner", tenant_id: B, user_id: HA }],
    ];
    for (const [name, u] of [
      ["nogrant", NOGRANT],
      ["ext", EXT],
    ] as const) {
      for (const [m, p, b] of routes) {
        const r = await call(u, m, p, b);
        expect([name, m, p, r.status, code(r)]).toEqual([name, m, p, 403, "PACK_FORBIDDEN"]);
      }
    }
    expect(await threads()).toBe(0);
  });
});

describe("CR-169 3a · tạo cuộc partner (N2: Vy ≠ người mời, Hà ≠ người đồng ý)", () => {
  it("Vy mở cuộc với Hà ⇒ 201 chi tiết đúng contract; lặp lại ⇒ 200 cùng id; Hà mở ngược ⇒ 200 cùng id", async () => {
    const r = await call(VY, "POST", `${MSG}/conversations`, {
      kind: "partner",
      tenant_id: B,
      user_id: HA,
    });
    expect(r.status).toBe(201);
    const d = ConversationDetailSchema.parse(r.body);
    expect(d.kind).toBe("partner");
    expect(d.company).toEqual({ id: B, name: "Preschool Việt" });
    expect(d.peer).toMatchObject({
      id: HA,
      name: "Hà",
      job_title: "Kế toán trưởng",
      active: true,
    });
    expect(d.read_only).toBe(false);
    expect(d.my_role).toBe("member");
    expect(d.members.map((m) => m.user_id).sort()).toEqual([VY, HA].sort());
    vyHa = d.id;
    const again = await create(VY, B, HA);
    expect([again.status, again.body.id]).toEqual([200, vyHa]);
    const rev = await create(HA, A, VY);
    expect([rev.status, rev.body.id]).toEqual([200, vyHa]);
  });

  it("công ty thứ ba (C) mở với Hà (B) ⇒ 409; E không quan hệ ⇒ 409; công ty mình / người không quyền / external ⇒ 422; khoá lạ ⇒ 400", async () => {
    const c = await create(CUONG, B, HA);
    expect([c.status, code(c)]).toEqual([409, "MSG_NOT_CONNECTED"]);
    const e = await create(EVA, A, VY);
    expect([e.status, code(e)]).toEqual([409, "MSG_NOT_CONNECTED"]);
    const own = await create(VY, A, LAN);
    expect([own.status, code(own)]).toEqual([422, "MSG_USER_INVALID"]);
    expect((await create(VY, B, EXT)).status).toBe(422);
    expect((await create(CUONG, A, NOGRANT)).status).toBe(422);
    const bad = await call(VY, "POST", `${MSG}/conversations`, {
      kind: "partner",
      tenant_id: B,
      user_id: HA,
      x: 1,
    });
    expect(bad.status).toBe(400);
    expect(await threads()).toBe(1);
  });
});

describe("CR-169 3a · danh sách hợp nhất + chưa đọc", () => {
  it("Hà gửi 2 tin ⇒ Vy: unread 2; danh sách `all` có cuộc partner (công ty, tên người gửi, chưa đọc 2) lẫn cuộc nội bộ, mới nhất trước", async () => {
    const dm = await call(TIEN, "POST", `${MSG}/conversations`, { kind: "direct", user_id: VY });
    expect(dm.status).toBe(201);
    for (const body of ["Chào anh Vy", "Gửi báo giá"])
      await as(
        B,
        HA,
        (tx) =>
          tx`select * from hub.pmsg_send(${vyHa}::uuid, ${randomUUID()}::uuid, ${body}, '{}'::uuid[])`,
      );
    expect((await call<{ total: number }>(VY, "GET", `${MSG}/unread`)).body.total).toBe(2);
    const r = await call(VY, "GET", `${MSG}/conversations`);
    expect(r.status).toBe(200);
    const page = ConversationPageSchema.parse(r.body);
    expect(page.items.map((x) => x.kind)).toEqual(["partner", "direct"]);
    expect(page.items[0]).toMatchObject({
      id: vyHa,
      unread: 2,
      company: { id: B },
      read_only: false,
    });
    expect(page.items[0]?.last_message).toMatchObject({
      sender_id: HA,
      sender_name: "Hà",
      preview: "Gửi báo giá",
    });
    expect(page.items[1]).toMatchObject({ company: null, read_only: false });
  });

  it("lọc công ty: own ⇒ nội bộ; B ⇒ cuộc với B; C (chưa có cuộc) ⇒ rỗng; sai dạng ⇒ 400; limit=1 qua cả hai nguồn không trùng/sót", async () => {
    const kinds = async (q: string) =>
      (await call<Page>(VY, "GET", `${MSG}/conversations${q}`)).body.items.map((x) => x.kind);
    expect(await kinds("?company=own")).toEqual(["direct"]);
    expect(await kinds(`?company=${A}`)).toEqual(["direct"]);
    expect(await kinds(`?company=${B}`)).toEqual(["partner"]);
    expect(await kinds(`?company=${C}`)).toEqual([]);
    expect((await call(VY, "GET", `${MSG}/conversations?company=abc`)).status).toBe(400);
    const p1 = await call<Page>(VY, "GET", `${MSG}/conversations?limit=1`);
    expect(p1.body.items.map((x) => x.kind)).toEqual(["partner"]);
    expect(p1.body.next_cursor).not.toBeNull();
    const p2 = await call<Page>(
      VY,
      "GET",
      `${MSG}/conversations?limit=1&cursor=${p1.body.next_cursor}`,
    );
    expect(p2.body.items.map((x) => x.kind)).toEqual(["direct"]);
    expect(p2.body.next_cursor).toBeNull();
  });

  it("công ty thứ ba / người ngoài cuộc không thấy cuộc Vy–Hà: Cường, Lan ⇒ không có trong danh sách, chưa đọc 0", async () => {
    for (const u of [CUONG, LAN]) {
      const r = await call<Page>(u, "GET", `${MSG}/conversations`);
      expect([u, r.body.items.some((x) => x.id === vyHa)]).toEqual([u, false]);
      expect([u, (await call<{ total: number }>(u, "GET", `${MSG}/unread`)).body.total]).toEqual([
        u,
        0,
      ]);
    }
    expect(
      (await call<Page>(CUONG, "GET", `${MSG}/conversations?company=${B}`)).body.items,
    ).toEqual([]);
  });
});

describe("CR-169 3a · danh bạ + công ty", () => {
  it("`all`: người A (trừ mình/người không quyền) + B + C; chức vụ + công ty; không lộ external/NOGRANT; con trỏ keyset không trùng", async () => {
    const page = parsePeople(await call(VY, "GET", `${MSG}/people?limit=50`));
    const ids = page.items.map((p) => p.id);
    for (const x of [HA, CUONG, TIEN, DUNG]) expect(ids).toContain(x);
    for (const x of [VY, NOGRANT, EXT, EVA]) expect(ids).not.toContain(x);
    expect(page.items.find((p) => p.id === HA)).toMatchObject({
      job_title: "Kế toán trưởng",
      company: { id: B, name: "Preschool Việt" },
      department: null,
    });
    const p1 = parsePeople(await call(VY, "GET", `${MSG}/people?limit=2`));
    expect(p1.next_cursor).not.toBeNull();
    const p2 = parsePeople(
      await call(VY, "GET", `${MSG}/people?limit=50&cursor=${p1.next_cursor}`),
    );
    expect([...p1.items, ...p2.items].map((p) => p.id)).toEqual(ids);
  });

  it("`company=B` chỉ người B; Hà hỏi công ty C (B–C không kết nối) ⇒ rỗng; `q` tìm tên/chức vụ không dấu; `own` ⇒ đồng nghiệp kèm company A; cursor/company hỏng ⇒ 400", async () => {
    const b = parsePeople(await call(VY, "GET", `${MSG}/people?company=${B}`));
    expect([...new Set(b.items.map((p) => p.company.id))]).toEqual([B]);
    expect(parsePeople(await call(HA, "GET", `${MSG}/people?company=${C}`)).items).toEqual([]);
    const q = parsePeople(await call(VY, "GET", `${MSG}/people?q=ke%20toan`));
    expect(q.items.map((p) => p.id)).toEqual([HA]);
    const own = parsePeople(await call(VY, "GET", `${MSG}/people?company=own`));
    expect(own.items.length).toBeGreaterThan(0);
    for (const p of own.items) expect(p.company.id).toBe(A);
    expect((await call(VY, "GET", `${MSG}/people?company=zzz`)).status).toBe(400);
    expect((await call(VY, "GET", `${MSG}/people?cursor=@@`)).status).toBe(400);
  });

  it("công ty đang kết nối: Vy thấy C, B (theo tên); Hà chỉ A; Eva rỗng; limit=1 + cursor đủ, không trùng", async () => {
    const ids = (r: Res) => parseCompanies(r).items.map((c) => c.id);
    expect(ids(await call(VY, "GET", `${MSG}/companies`))).toEqual([C, B]); // "Công ty Cờ" < "Preschool Việt"
    const p1 = parseCompanies(await call(VY, "GET", `${MSG}/companies?limit=1`));
    const p2 = parseCompanies(
      await call(VY, "GET", `${MSG}/companies?limit=1&cursor=${p1.next_cursor}`),
    );
    expect([...p1.items, ...p2.items].map((c) => c.id)).toEqual([C, B]);
    expect(p2.next_cursor).toBeNull();
    expect(ids(await call(HA, "GET", `${MSG}/companies`))).toEqual([A]);
    expect(ids(await call(EVA, "GET", `${MSG}/companies`))).toEqual([]);
    expect((await call(VY, "GET", `${MSG}/companies?cursor=@@`)).status).toBe(400);
  });

  it("ngắt kết nối A–B ⇒ B biến khỏi danh bạ/công ty của Vy; cuộc cũ còn ở dạng chỉ đọc; tạo mới ⇒ 409", async () => {
    await o`update hub.partner_links set accepted_at = null where from_tenant = ${B} and to_tenant = ${A}`;
    expect(
      parseCompanies(await call(VY, "GET", `${MSG}/companies`)).items.map((c) => c.id),
    ).toEqual([C]);
    expect(parsePeople(await call(VY, "GET", `${MSG}/people?company=${B}`)).items).toEqual([]);
    const l = ConversationPageSchema.parse(
      (await call(VY, "GET", `${MSG}/conversations?company=${B}`)).body,
    );
    expect(l.items.map((x) => [x.id, x.read_only])).toEqual([[vyHa, true]]);
    const r = await create(VY, B, HA);
    expect([r.status, code(r)]).toEqual([409, "MSG_NOT_CONNECTED"]);
  });
});
