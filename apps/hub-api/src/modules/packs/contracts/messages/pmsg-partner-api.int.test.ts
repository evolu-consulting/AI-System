// CR-169 · lát 3b · spec §3 (P3–P7, P12–P14) · §4 · §7: route `/pack/contracts/messages/partner/:id/**` thật (Hono + pool `hub_api` + role `contracts_rw` + RLS + Redis + FileBox giả).
// Công ty: A (NitiGroup) — B (Preschool) đã kết nối; C kết nối A nhưng KHÔNG với B (công ty thứ ba của cuộc A–B); E không quan hệ. N2: Vy (nhân viên A) ≠ người ngắt/duyệt, Hà (viewer B) ≠ người mở.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../../lib/db";
import { mapError } from "../../../../lib/errors";
import { createRedis, type Redis } from "../../../../lib/redis";
import { userStreamKey } from "../../../../lib/user-stream";
import { parseFields } from "../../../me-stream/user-stream-reader";
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
const LOCK = userId(1704); // A · editor nhưng bị khoá bởi công ty (qua guard, hỏng ở DB)
const REDIS_TEST_URL = process.env.HUB_TEST_REDIS_URL ?? "redis://localhost:6379/15";
const ORG = "a1695000-0000-4000-8000-000000000001";
const F = { read: "f-r", write: "f-w", admin: "f-a" };
let o: Sql;
let db: Db;
let redis: Redis;
/** FileBox giả: đếm byte lên/gỡ, link theo org. */
const box = { puts: 0, live: new Set<string>(), removed: [] as { org: string; id: string }[] };
const fakeBox = (org: string) => ({
  postFile: async () => {
    box.puts++;
    const fileId = randomUUID().replaceAll("-", "").slice(0, 16);
    box.live.add(fileId);
    return { fileId, versionId: "v1" };
  },
  getLink: async (id: string) => (box.live.has(id) ? `https://fb.test/${org}/${id}` : null),
  deleteFile: async (id: string) => {
    box.removed.push({ org, id });
    return box.live.delete(id) ? ("deleted" as const) : ("missing" as const);
  },
});
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
  h.route("/", messagesModule(db, view(), { redis, filebox: fakeBox }));
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
const MSG = "/messages";
const create = (user: string, tenant: string, peer: string) =>
  call<{ id: string }>(user, "POST", `${MSG}/conversations`, {
    kind: "partner",
    tenant_id: tenant,
    user_id: peer,
  });
type Page = { items: { id: string; kind: string }[]; next_cursor: string | null };

let vyHa = "";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 3);
  redis = createRedis(REDIS_TEST_URL);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'pa-a', 'A', 'NitiGroup', '0100000501', true), (${B}, 'pa-b', 'B', 'Preschool Việt', '0100000502', true),
           (${C}, 'pa-c', 'C', 'Công ty Cờ', '0100000503', true), (${E}, 'pa-e', 'E', 'Công ty Ê', '0100000504', true)`;
  await users(o, A, 4, { from: 1695 });
  await users(o, A, 1, { from: 1704 });
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
  await members(o, A, g(A, "editor"), [LOCK]);
  await o`update admin.users set locked_by_tenant = true where id = ${LOCK}`;
  await members(o, B, g(B, "owner"), [DUNG]);
  await members(o, B, g(B, "viewer"), [HA]);
  await members(o, C, g(C, "owner"), [CUONG]);
  await members(o, E, g(E, "owner"), [EVA]);
  who = new Map([
    [TIEN, { tenant: A, group: g(A, "owner"), kind: "internal" }],
    [VY, { tenant: A, group: g(A, "editor"), kind: "internal" }],
    [LAN, { tenant: A, group: g(A, "viewer"), kind: "internal" }],
    [NOGRANT, { tenant: A, group: randomUUID(), kind: "internal" }],
    [LOCK, { tenant: A, group: g(A, "editor"), kind: "internal" }],
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
  redis?.disconnect();
});

const P = (id: string) => `${MSG}/partner/${id}`;
const send = (
  user: string,
  id: string,
  body: string,
  file_ids: string[] = [],
  cid = randomUUID(),
) =>
  call<{ seq: number; id: string; client_id: string; files: { id: string }[] }>(
    user,
    "POST",
    `${P(id)}/messages`,
    { client_id: cid, body, file_ids },
  );
const upload = async (user: string, id: string, name: string, bytes: Uint8Array) => {
  const fd = new FormData();
  fd.set("file", new File([Buffer.from(bytes)], name));
  const r = await app(user).request(`${P(id)}/files`, { method: "POST", body: fd });
  return { status: r.status, body: (await r.json()) as { id: string; error?: { code?: string } } };
};
const frames = async (u: string) =>
  (await redis.xrange(userStreamKey(u), "-", "+")).map(([, f]) => parseFields(f)?.event);
const clearStreams = () =>
  Promise.all([VY, HA, LAN, CUONG, EVA, DUNG].map((u) => redis.del(userStreamKey(u))));
const PDF = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);
let fileA = ""; // tệp Vy đã gửi kèm tin

describe("CR-169 3b · hai đầu: mở, gửi idempotent, đọc, đã xem, sự kiện chỉ cho hai người (N2)", () => {
  it("Vy mở + gửi (201); gửi lặp cùng client_id ⇒ 200 cùng seq và KHÔNG phát lại; Hà (không phải người mở) đọc được", async () => {
    vyHa = (await create(VY, B, HA)).body.id;
    await clearStreams();
    const cid = randomUUID();
    const s1 = await send(VY, vyHa, "chào Hà", [], cid);
    expect([s1.status, s1.body.seq]).toEqual([201, 1]);
    const s2 = await send(VY, vyHa, "chào Hà", [], cid);
    expect([s2.status, s2.body.seq, s2.body.id]).toEqual([200, 1, s1.body.id]);
    expect(await frames(VY)).toEqual(["msg.new"]); // một khung dù gửi hai lần
    expect(await frames(HA)).toEqual(["msg.new"]);
    for (const u of [LAN, CUONG, EVA, DUNG]) expect([u, await frames(u)]).toEqual([u, []]);
    const d = await call<{ id: string; kind: string; members: unknown[] }>(HA, "GET", P(vyHa));
    expect([d.status, d.body.kind, d.body.members.length]).toEqual([200, "partner", 2]);
    const pg = await call<{ items: { seq: number; body: string }[]; has_more: boolean }>(
      HA,
      "GET",
      `${P(vyHa)}/messages?limit=1`,
    );
    expect([pg.status, pg.body.items.map((m) => m.body), pg.body.has_more]).toEqual([
      200,
      ["chào Hà"],
      false,
    ]);
  });

  it("trang tin cũ → mới, cursor before_seq; Hà đọc ⇒ unread_total 0, Vy thấy «đã xem», khung msg.read tới hai đầu; đọc lại không phát", async () => {
    await send(VY, vyHa, "tin 2");
    await send(VY, vyHa, "tin 3");
    const p1 = await call<{ items: { seq: number }[]; has_more: boolean }>(
      VY,
      "GET",
      `${P(vyHa)}/messages?limit=2`,
    );
    expect([p1.body.items.map((m) => m.seq), p1.body.has_more]).toEqual([[2, 3], true]);
    const p2 = await call<{ items: { seq: number }[]; has_more: boolean }>(
      VY,
      "GET",
      `${P(vyHa)}/messages?limit=2&before_seq=2`,
    );
    expect([p2.body.items.map((m) => m.seq), p2.body.has_more]).toEqual([[1], false]);
    expect((await call<{ total: number }>(HA, "GET", `${MSG}/unread`)).body.total).toBe(3);
    await clearStreams();
    const rd = await call<{ unread_total: number }>(HA, "POST", `${P(vyHa)}/read`, { seq: 99 });
    expect([rd.status, rd.body.unread_total]).toEqual([200, 0]);
    expect((await frames(VY)).concat(await frames(HA))).toEqual(["msg.read", "msg.read"]);
    await clearStreams();
    await call(HA, "POST", `${P(vyHa)}/read`, { seq: 99 });
    expect(await frames(VY)).toEqual([]); // mốc không tiến ⇒ không phát
    const d = await call<{ members: { user_id: string; last_read_seq: number }[] }>(
      VY,
      "GET",
      P(vyHa),
    );
    expect(d.body.members.find((m) => m.user_id === HA)?.last_read_seq).toBe(3);
  });

  it("kiểm đầu vào: tin rỗng không tệp ⇒ 400 MSG_EMPTY; id/seq sai dạng ⇒ 404; thân `read` sai ⇒ 400", async () => {
    const e = await send(VY, vyHa, "   ");
    expect([e.status, code(e)]).toEqual([400, "MSG_EMPTY"]);
    expect((await call(VY, "GET", `${MSG}/partner/khong-phai-uuid`)).status).toBe(404);
    expect((await call(VY, "DELETE", `${P(vyHa)}/messages/abc`)).status).toBe(404);
    expect((await call(VY, "POST", `${P(vyHa)}/read`, { seq: -1 })).status).toBe(400);
  });
});

describe("CR-169 3b · tệp: tải lên, chưa gắn thì chỉ người tải thấy, gắn tin, thu hồi gỡ byte", () => {
  it("Vy tải PDF (201) → Hà chưa tải được (404) → Vy gửi kèm → Hà lấy link (org công ty Vy)", async () => {
    const up = await upload(VY, vyHa, "bao-gia.pdf", PDF);
    expect(up.status).toBe(201);
    expect(box.puts).toBe(1);
    expect((await call(HA, "GET", `${P(vyHa)}/files/${up.body.id}/link`)).status).toBe(404);
    const own = await call<{ url: string }>(VY, "GET", `${P(vyHa)}/files/${up.body.id}/link`);
    expect(own.status).toBe(200);
    const m = await send(VY, vyHa, "báo giá đây", [up.body.id]);
    expect([m.status, m.body.files.length]).toEqual([201, 1]);
    fileA = up.body.id;
    const link = await call<{ url: string }>(HA, "GET", `${P(vyHa)}/files/${fileA}/link`);
    expect(link.status).toBe(200);
    expect(link.body.url).toContain(`t_${A}`);
  });

  it("đuôi lạ ⇒ 415; > 20 MB ⇒ 413 trước khi đọc thân; không byte nào lên FileBox", async () => {
    const before = box.puts;
    const bad = await upload(VY, vyHa, "virus.exe", PDF);
    expect([bad.status, code(bad)]).toEqual([415, "MSG_FILE_TYPE"]);
    const big = await upload(VY, vyHa, "to.pdf", new Uint8Array(20 * 1024 * 1024 + 1));
    expect([big.status, code(big)]).toEqual([413, "MSG_FILE_TOO_LARGE"]);
    expect(box.puts).toBe(before);
  });

  it("DB từ chối (≥ 50 tệp chưa gắn) ⇒ byte vừa lên bị xoá, không mồ côi", async () => {
    let last = { status: 0 };
    for (let i = 0; i < 52 && last.status !== 422; i++)
      last = await upload(VY, vyHa, `t${i}.pdf`, PDF);
    expect(last.status).toBe(422);
    expect(box.live.size).toBe(box.puts - box.removed.length);
    expect(box.live.size).toBe(51); // 1 đã gắn tin + 50 chưa gắn (lần bị từ chối đã gỡ byte)
  });

  it("Hà thu hồi tin của Vy ⇒ 403 MSG_NOT_SENDER; Vy thu hồi ⇒ 204, tệp 404 cho Hà, byte gỡ khỏi org Vy, khung msg.deleted hai đầu, lặp vô hại", async () => {
    const list = await call<{ items: { seq: number; files: unknown[] }[] }>(
      VY,
      "GET",
      `${P(vyHa)}/messages?limit=50`,
    );
    const seq = list.body.items.find((x) => x.files.length === 1)?.seq as number;
    const no = await call(HA, "DELETE", `${P(vyHa)}/messages/${seq}`);
    expect([no.status, code(no)]).toEqual([403, "MSG_NOT_SENDER"]);
    await clearStreams();
    const ok = await app(VY).request(`${P(vyHa)}/messages/${seq}`, { method: "DELETE" });
    expect(ok.status).toBe(204);
    expect(box.removed.some((r) => r.org === `t_${A}`)).toBe(true);
    expect((await call(HA, "GET", `${P(vyHa)}/files/${fileA}/link`)).status).toBe(404);
    expect((await frames(VY)).concat(await frames(HA))).toEqual(["msg.deleted", "msg.deleted"]);
    const again = await app(VY).request(`${P(vyHa)}/messages/${seq}`, { method: "DELETE" });
    expect(again.status).toBe(204);
  });
});

describe("CR-169 3b · cách ly: ngoài cuộc / công ty thứ ba ⇒ 404 cùng thân; external, không quyền ⇒ 403", () => {
  it("Lan (đồng nghiệp ngoài cuộc), Dũng (cùng công ty Hà, ngoài cuộc), Cường (công ty thứ ba), Eva: mọi route 404 MSG_NOT_FOUND, không phát sự kiện", async () => {
    const someFile = randomUUID();
    await clearStreams();
    for (const u of [LAN, DUNG, CUONG, EVA]) {
      const out: [string, string, unknown?][] = [
        ["GET", P(vyHa)],
        ["GET", `${P(vyHa)}/messages`],
        [
          "POST",
          `${P(vyHa)}/messages`,
          { client_id: randomUUID(), body: "xâm nhập", file_ids: [] },
        ],
        ["DELETE", `${P(vyHa)}/messages/1`],
        ["POST", `${P(vyHa)}/read`, { seq: 1 }],
        ["GET", `${P(vyHa)}/files/${someFile}/link`],
      ];
      for (const [m, p, b] of out) {
        const r = await call(u, m, p, b);
        expect([u, m, p, r.status, code(r)]).toEqual([u, m, p, 404, "MSG_NOT_FOUND"]);
      }
      expect([u, (await upload(u, vyHa, "x.pdf", PDF)).status]).toEqual([u, 404]);
    }
    for (const u of [VY, HA, LAN, CUONG, EVA, DUNG]) expect([u, await frames(u)]).toEqual([u, []]);
    expect(
      (await o`select count(*)::int as n from hub.pmsg_messages where body = 'xâm nhập'`)[0]?.n,
    ).toBe(0);
  });

  it("external và người không có quyền Sổ Hợp Tác ⇒ 403 PACK_FORBIDDEN ở mọi route partner", async () => {
    for (const u of [EXT, NOGRANT]) {
      for (const [m, p, b] of [
        ["GET", P(vyHa)],
        ["GET", `${P(vyHa)}/messages`],
        ["POST", `${P(vyHa)}/messages`, { client_id: randomUUID(), body: "x", file_ids: [] }],
        ["DELETE", `${P(vyHa)}/messages/1`],
        ["POST", `${P(vyHa)}/read`, { seq: 1 }],
      ] as [string, string, unknown?][]) {
        const r = await call(u, m, p, b);
        expect([u, m, p, r.status, code(r)]).toEqual([u, m, p, 403, "PACK_FORBIDDEN"]);
      }
      expect((await upload(u, vyHa, "x.pdf", PDF)).status).toBe(403);
    }
  });
});

describe("CR-169 3b · lỗi quyền phần đối tác không làm hỏng phần nội bộ (Minor 1 của soát 3a)", () => {
  it("người qua guard nhưng KHÔNG còn hợp lệ ở DB (bị công ty khoá): unread/danh sách `all`/`own` vẫn 200; lọc công ty và cuộc partner ⇒ 403", async () => {
    const un = await call<{ total: number }>(LOCK, "GET", `${MSG}/unread`);
    expect([un.status, un.body.total]).toEqual([200, 0]);
    const all = await call<Page>(LOCK, "GET", `${MSG}/conversations`);
    expect([all.status, all.body.items.length]).toEqual([200, 0]);
    expect((await call<Page>(LOCK, "GET", `${MSG}/conversations?company=own`)).status).toBe(200);
    const co = await call(LOCK, "GET", `${MSG}/conversations?company=${B}`);
    expect([co.status, code(co)]).toEqual([403, "PACK_FORBIDDEN"]);
    const d = await call(LOCK, "GET", P(vyHa));
    expect([d.status, code(d)]).toEqual([403, "PACK_FORBIDDEN"]);
  });
});

describe("CR-169 3b · ngắt kết nối: đọc được, không gửi, không tải lên", () => {
  it("sau ngắt: đọc trang tin + chi tiết read_only OK; gửi và tải lên ⇒ 409 MSG_NOT_CONNECTED (không byte nào lên FileBox); đã đọc, thu hồi vẫn được", async () => {
    await o`delete from hub.partner_links where (from_tenant, to_tenant) in ((${A}, ${B}), (${B}, ${A}))`;
    const before = box.puts;
    const pg = await call<{ items: unknown[] }>(HA, "GET", `${P(vyHa)}/messages`);
    expect([pg.status, pg.body.items.length > 0]).toEqual([200, true]);
    const d = await call<{ partner: { read_only: boolean } }>(VY, "GET", P(vyHa));
    expect(d.body.partner.read_only).toBe(true);
    const s = await send(VY, vyHa, "sau ngắt");
    expect([s.status, code(s)]).toEqual([409, "MSG_NOT_CONNECTED"]);
    const up = await upload(HA, vyHa, "sau.pdf", PDF);
    expect([up.status, up.body.error?.code, box.puts]).toEqual([409, "MSG_NOT_CONNECTED", before]);
    expect((await call(HA, "POST", `${P(vyHa)}/read`, { seq: 1 })).status).toBe(200);
    expect((await app(VY).request(`${P(vyHa)}/messages/1`, { method: "DELETE" })).status).toBe(204);
  });
});
