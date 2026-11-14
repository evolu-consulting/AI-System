// CR-161 · lát 6 · spec §2 R8, R11 · §3 · §5: route trò chuyện + tệp thật (Hono + pool `hub_api` + role `contracts_rw` + RLS, FileBox giả, Redis giả bắt khung).
// R1: nhân viên (Vy: read+write, KHÔNG admin) ⇒ 403 cho MỌI route trò chuyện/tệp, 0 dòng, 0 byte. N2: Hoa (Toàn quyền thứ hai của A, không phải người gửi) và Dung (B) dùng được.
// Công ty thứ ba (C) ⇒ 404 / 409, không dòng. Sau ngắt: đọc được (read_only), gửi/tải lên ⇒ 409, tệp cũ vẫn tải được. Dọn tệp chưa gắn > 24 h.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  CcFileUploadResponseSchema,
  CcMessagesResponseSchema,
  CcMsgEventDataSchema,
  CcSendResponseSchema,
} from "@ai/contracts/pack-contracts";
import { createDb, type Db } from "@ai/db";
import { enablePack, members, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { mapError } from "../../../../lib/errors";
import { userStreamKey } from "../../../../lib/user-stream";
import type { PackAccessView, PackGuardVars } from "../../kit/public";
import { ccFilesSweepClaim } from "./adapters/chat.repo";
import { chatFileSweep } from "./application/chat.usecase";
import { connectModule } from "./connect.mount";

const A = tenantId(1640); // NitiGroup
const B = tenantId(1641); // Preschool
const C = tenantId(1642); // công ty thứ ba
const TIEN = userId(1640); // A · Toàn quyền
const VY = userId(1641); // A · nhân viên (read+write)
const HOA = userId(1642); // A · Toàn quyền thứ hai (không phải người gửi)
const DUNG = userId(1643); // B · Toàn quyền
const CUONG = userId(1644); // C · Toàn quyền
const F = { read: "f-r", write: "f-w", admin: "f-a" };
let o: Sql;
let db: Db;
let who: Map<string, { tenant: string; group: string }>;
let grp: Map<string, Record<"owner" | "editor" | "viewer", string>>;
const puts: { org: string; name: string; id: string }[] = [];
const removed: string[] = [];
const sent: { key: string; event: string; data: unknown }[] = [];

const filebox = (org: string) => ({
  postFile: async (name: string) => {
    const id = Bun.randomUUIDv7();
    puts.push({ org, name, id });
    return { fileId: id, versionId: Bun.randomUUIDv7() };
  },
  deleteFile: async (id: string) => {
    removed.push(`${org}:${id}`);
    return "deleted" as const;
  },
  getLink: async (id: string) => `https://fb.test/${org}/${id}`,
});
const fakeRedis = {
  pipeline: () => {
    const calls: string[][] = [];
    const p = {
      xadd: (key: string, ...a: unknown[]) => (calls.push([key, String(a.at(-1))]), p),
      expire: () => p,
      exec: async () => {
        for (const [key, body] of calls)
          sent.push({ key: key as string, ...JSON.parse(body as string) });
        return [];
      },
    };
    return p;
  },
};

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
    c.set("user", { userId: user, tenantId: w?.tenant, role: "member" } as never);
    await next();
  });
  h.route("/", connectModule(db, view(), { redis: fakeRedis as never, filebox }));
  h.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return h;
}
type Res<T = unknown> = { status: number; body: T; location: string | null };
const req = async <T = unknown>(
  user: string,
  method: string,
  path: string,
  body?: unknown | FormData,
) => {
  const isForm = body instanceof FormData;
  const r = await app(user).request(path, {
    method,
    redirect: "manual",
    ...(body === undefined
      ? {}
      : isForm
        ? { body }
        : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
  });
  const text = await r.text();
  return {
    status: r.status,
    body: text ? JSON.parse(text) : null,
    location: r.headers.get("location"),
  } as Res<T>;
};
const code = (r: Res) => (r.body as { error?: { code?: string } } | null)?.error?.code;
const form = (name: string, bytes: Uint8Array | string = "%PDF-1.4") => {
  const f = new FormData();
  f.append("file", new File([bytes], name));
  return f;
};
const n = (sqlText: Promise<{ n: number }[]>) => sqlText.then((r) => r[0]?.n as number);
const nMsgs = () => n(o`select count(*)::int as n from hub.cc_messages`);
const nFiles = () => n(o`select count(*)::int as n from hub.cc_files`);

type Page = {
  items: {
    seq: number;
    mine: boolean;
    body: string;
    sender_company: string;
    files: { id: string }[];
  }[];
  next_before: number | null;
  read_only: boolean;
  last_read_seq: number;
};
const msgs = `/connect/threads/${B}/messages`;
const msgsA = `/connect/threads/${A}/messages`;
let fileId = "";

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code, directory_listed)
    values (${A}, 'cc-a', 'A', 'NitiGroup', '0100000301', true), (${B}, 'cc-b', 'B', 'Preschool Việt', '0100000302', true),
           (${C}, 'cc-c', 'C', 'Công ty Cờ', '0100000303', true)`;
  await users(o, A, 3, { from: 1640 });
  await users(o, B, 1, { from: 1643 });
  await users(o, C, 1, { from: 1644 });
  grp = await enablePack(o, [A, B, C], "contracts");
  const g = (t: string) => grp.get(t) as Record<"owner" | "editor" | "viewer", string>;
  await members(o, A, g(A).owner, [TIEN, HOA]);
  await members(o, A, g(A).editor, [VY]);
  await members(o, B, g(B).owner, [DUNG]);
  await members(o, C, g(C).owner, [CUONG]);
  who = new Map([
    [TIEN, { tenant: A, group: g(A).owner }],
    [VY, { tenant: A, group: g(A).editor }],
    [HOA, { tenant: A, group: g(A).owner }],
    [DUNG, { tenant: B, group: g(B).owner }],
    [CUONG, { tenant: C, group: g(C).owner }],
  ]);
  // A và B đã kết nối (hai dòng chấp nhận, như sau «Đồng ý»).
  await o`insert into hub.partner_links (from_tenant, to_tenant, requested_at, accepted_at)
    values (${A}, ${B}, now(), now()), (${B}, ${A}, now(), now())`;
  db = createDb(urls().hubApi, { max: 4 });
}, 90_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const SEND = { client_id: Bun.randomUUIDv7(), body: "x" };
const ROUTES: [string, string, unknown?][] = [
  ["GET", msgs],
  ["POST", msgs, SEND],
  ["POST", `/connect/threads/${B}/read`, { seq: 1 }],
  ["POST", `/connect/threads/${B}/files`, undefined],
  ["GET", `/connect/files/${Bun.randomUUIDv7()}`],
];

describe("CR-161 · R1 cổng Toàn quyền ở route trò chuyện", () => {
  it("nhân viên (Vy) gọi MỌI route trò chuyện/tệp ⇒ 403 PACK_FORBIDDEN, 0 tin, 0 tệp, 0 byte lên kho", async () => {
    for (const [m, p, b] of ROUTES) {
      const body = p.endsWith("/files") && m === "POST" ? form("a.pdf") : b;
      const r = await req(VY, m, p, body);
      expect([m, p, r.status, code(r)]).toEqual([m, p, 403, "PACK_FORBIDDEN"]);
    }
    expect([await nMsgs(), await nFiles(), puts.length, sent.length]).toEqual([0, 0, 0, 0]);
  });
});

describe("CR-161 · R8 gửi / xem / đã đọc (hai công ty, hai vai khác nhau)", () => {
  it("Tiên gửi ⇒ 200 đúng contract; gửi lặp cùng client_id ⇒ created=false, không tăng seq, không chuông/khung lặp", async () => {
    const r = await req<{
      message: { seq: number; mine: boolean; sender_company: string };
      created: boolean;
    }>(TIEN, "POST", msgs, {
      client_id: "7a000000-0000-4000-8000-000000000001",
      body: "  Chào Preschool ",
    });
    expect(r.status).toBe(200);
    expect(CcSendResponseSchema.safeParse(r.body).success).toBe(true);
    expect([
      r.body.created,
      r.body.message.seq,
      r.body.message.mine,
      r.body.message.sender_company,
    ]).toEqual([true, 1, true, "NitiGroup"]);
    const again = await req<typeof r.body>(TIEN, "POST", msgs, {
      client_id: "7a000000-0000-4000-8000-000000000001",
      body: "khác",
    });
    expect([again.body.created, again.body.message.seq]).toEqual([false, 1]);
    expect(await nMsgs()).toBe(1);
    const bells = await o<
      { user_id: string; link: string; fanout_at: Date | null }[]
    >`select user_id, link, fanout_at from hub.notifications where tenant_id = ${B} and kind = 'cc.msg'`;
    expect(bells).toHaveLength(1);
    expect([bells[0]?.user_id, bells[0]?.fanout_at === null]).toEqual([DUNG, false]); // không email/push
    expect(bells[0]?.link).toContain(`tenant=${A}&tab=chat`);
  });

  it("cc.msg phát tới người Toàn quyền CẢ HAI công ty (tab khác của người gửi cũng nhận), khung mang công ty KIA; Vy (nhân viên) không nhận; gửi lặp không phát", () => {
    const by = (u: string) => sent.filter((s) => s.key === userStreamKey(u));
    expect(by(TIEN).map((s) => s.data)).toEqual([{ tenant_id: B, seq: 1 }]);
    expect(by(HOA).map((s) => s.data)).toEqual([{ tenant_id: B, seq: 1 }]);
    expect(by(DUNG).map((s) => [s.event, s.data])).toEqual([["cc.msg", { tenant_id: A, seq: 1 }]]);
    expect(by(VY)).toHaveLength(0);
    expect(by(DUNG).every((s) => CcMsgEventDataSchema.safeParse(s.data).success)).toBe(true);
  });

  it("N2: Dung (B, không phải người gửi) xem thấy tin (mine=false) rồi trả lời; Hoa (A, không phải người gửi) thấy cả hai", async () => {
    const p = await req<Page>(DUNG, "GET", msgsA);
    expect(p.status).toBe(200);
    expect(CcMessagesResponseSchema.safeParse(p.body).success).toBe(true);
    expect(p.body.items.map((m) => [m.seq, m.mine, m.body, m.sender_company])).toEqual([
      [1, false, "  Chào Preschool ", "NitiGroup"],
    ]);
    const rep = await req<{ message: { seq: number } }>(DUNG, "POST", msgsA, {
      client_id: Bun.randomUUIDv7(),
      body: "Chào NitiGroup",
    });
    expect(rep.body.message.seq).toBe(2);
    const h = await req<Page>(HOA, "GET", msgs);
    expect(h.body.items.map((m) => [m.seq, m.mine])).toEqual([
      [2, false],
      [1, true],
    ]);
    expect(h.body.read_only).toBe(false);
  });

  it("trang tin: limit + before=seq (mới → cũ), next_before null khi hết; limit 0 / before 0 / khoá lạ ⇒ 400", async () => {
    for (let i = 3; i <= 6; i++)
      await req(TIEN, "POST", msgs, { client_id: Bun.randomUUIDv7(), body: `tin ${i}` });
    const p1 = await req<Page>(HOA, "GET", `${msgs}?limit=2`);
    expect([p1.body.items.map((m) => m.seq), p1.body.next_before]).toEqual([[6, 5], 5]);
    const p2 = await req<Page>(HOA, "GET", `${msgs}?limit=2&before=5`);
    expect([p2.body.items.map((m) => m.seq), p2.body.next_before]).toEqual([[4, 3], 3]);
    const p3 = await req<Page>(HOA, "GET", `${msgs}?before=3`);
    expect([p3.body.items.map((m) => m.seq), p3.body.next_before]).toEqual([[2, 1], null]);
    for (const q of ["limit=0", "before=0", "limit=101", "x=1"])
      expect((await req(HOA, "GET", `${msgs}?${q}`)).status).toBe(400);
  });

  it("đã đọc: chỉ tiến, kẹp ≤ tin cuối; links của Dung có unread đúng rồi về 0; seq âm / khoá lạ ⇒ 400", async () => {
    const links = await req<{ items: { tenant_id: string; unread: number }[] }>(
      DUNG,
      "GET",
      "/connect/links",
    );
    expect(links.body.items.find((x) => x.tenant_id === A)?.unread).toBe(4); // last_seq 6 − Dung đã đọc tới tin 2 của chính mình
    const r = await req<{ last_read_seq: number }>(DUNG, "POST", `/connect/threads/${A}/read`, {
      seq: 999,
    });
    expect(r.body).toEqual({ last_read_seq: 6 });
    expect(
      (await req<{ last_read_seq: number }>(DUNG, "POST", `/connect/threads/${A}/read`, { seq: 1 }))
        .body.last_read_seq,
    ).toBe(6);
    expect((await req<Page>(DUNG, "GET", msgsA)).body.last_read_seq).toBe(6);
    const after = await req<{ items: { tenant_id: string; unread: number }[] }>(
      DUNG,
      "GET",
      "/connect/links",
    );
    expect(after.body.items.find((x) => x.tenant_id === A)?.unread).toBe(0);
    for (const b of [{ seq: -1 }, { seq: 1, x: 1 }, {}])
      expect((await req(DUNG, "POST", `/connect/threads/${A}/read`, b)).status).toBe(400);
  });

  it("đầu vào sai: tin rỗng ⇒ 422 MSG_EMPTY; > 4000 ký tự / > 10 tệp / khoá lạ / client_id sai / id công ty sai / chính mình ⇒ 400; không ghi gì", async () => {
    const before = await nMsgs();
    const e1 = await req(TIEN, "POST", msgs, { client_id: Bun.randomUUIDv7(), body: " \n " });
    expect([e1.status, code(e1)]).toEqual([422, "MSG_EMPTY"]);
    const bad: unknown[] = [
      { client_id: Bun.randomUUIDv7(), body: "a".repeat(4001) },
      {
        client_id: Bun.randomUUIDv7(),
        body: "a",
        file_ids: Array.from({ length: 11 }, () => Bun.randomUUIDv7()),
      },
      { client_id: Bun.randomUUIDv7(), body: "a", x: 1 },
      { client_id: "khong-phai-uuid", body: "a" },
    ];
    for (const b of bad) expect((await req(TIEN, "POST", msgs, b)).status).toBe(400);
    expect(
      (await req(TIEN, "POST", "/connect/threads/khong-phai-uuid/messages", SEND)).status,
    ).toBe(400);
    expect((await req(TIEN, "POST", `/connect/threads/${A}/messages`, SEND)).status).toBe(400); // chính công ty mình
    expect(await nMsgs()).toBe(before);
  });
});

describe("CR-161 · R11 tệp", () => {
  it("tải lên ⇒ 200 CcFile, id = file_id FileBox, khoá <tenant bên tải>/<id>, org FileBox của bên tải; đuôi lạ / rỗng ⇒ 415; > 20 MB ⇒ 413; thiếu phần file ⇒ 400 (không byte nào lên kho)", async () => {
    const r = await req<{ file: { id: string; name: string; mime: string; size: number } }>(
      TIEN,
      "POST",
      `/connect/threads/${B}/files`,
      form("../bao-gia.pdf"),
    );
    expect(r.status).toBe(200);
    expect(CcFileUploadResponseSchema.safeParse(r.body).success).toBe(true);
    fileId = r.body.file.id;
    expect([r.body.file.name, r.body.file.mime]).toEqual(["bao-gia.pdf", "application/pdf"]);
    expect(puts).toEqual([{ org: `t_${A}`, name: "bao-gia.pdf", id: fileId }]);
    const [row] = await o<
      { storage_key: string; seq: string | null }[]
    >`select storage_key, seq from hub.cc_files where id = ${fileId}`;
    expect([row?.storage_key, row?.seq]).toEqual([`${A}/${fileId}`, null]);
    const up = (f: FormData) => req(TIEN, "POST", `/connect/threads/${B}/files`, f);
    expect((await up(form("virus.exe"))).status).toBe(415);
    expect((await up(form("a.pdf", ""))).status).toBe(415);
    expect((await up(form("big.pdf", new Uint8Array(20 * 1024 * 1024 + 1)))).status).toBe(413);
    expect((await up(new FormData())).status).toBe(400);
    expect(puts).toHaveLength(1);
  });

  it("tệp chưa gắn tin: chỉ người tải tải được (Hoa cùng công ty, Dung, công ty C ⇒ 404 không lộ); gửi kèm file_ids ⇒ gắn tin, rồi Dung tải được (302 tới org bên tải)", async () => {
    const dl = (u: string) => req(u, "GET", `/connect/files/${fileId}`);
    expect((await dl(TIEN)).status).toBe(302);
    for (const u of [HOA, DUNG, CUONG]) expect([u, (await dl(u)).status]).toEqual([u, 404]);
    const s = await req<{ message: { seq: number; files: { id: string }[] } }>(TIEN, "POST", msgs, {
      client_id: Bun.randomUUIDv7(),
      body: "",
      file_ids: [fileId],
    });
    expect(s.status).toBe(200);
    expect(s.body.message.files.map((f) => f.id)).toEqual([fileId]);
    const d = await dl(DUNG);
    expect([d.status, d.location]).toEqual([302, `https://fb.test/t_${A}/${fileId}`]);
    expect((await dl(HOA)).status).toBe(302); // đã gắn tin ⇒ người Toàn quyền của hai công ty
    expect((await dl(CUONG)).status).toBe(404);
    expect((await req(TIEN, "GET", "/connect/files/khong-phai-uuid")).status).toBe(400);
    // dùng lại tệp đã gắn / tệp của người khác trong tin mới ⇒ 422 MSG_FILE_INVALID
    const reuse = await req(TIEN, "POST", msgs, {
      client_id: Bun.randomUUIDv7(),
      body: "lại",
      file_ids: [fileId],
    });
    expect([reuse.status, code(reuse)]).toEqual([422, "MSG_FILE_INVALID"]);
  });

  it("DB từ chối (đủ 50 tệp chưa gắn) ⇒ 422 MSG_FILE_INVALID và byte vừa lên bị xoá khỏi kho", async () => {
    await o`insert into hub.cc_files (id, thread_id, tenant_id, user_id, name, mime, size, storage_key)
      select i, t.id, ${A}::uuid, ${HOA}::uuid, 'x.pdf', 'application/pdf', 10, ${A}::text || '/' || i::text
      from hub.cc_threads t, (select gen_random_uuid() as i from generate_series(1, 50)) g`;
    const r = await req(HOA, "POST", `/connect/threads/${B}/files`, form("them.pdf"));
    expect([r.status, code(r)]).toEqual([422, "MSG_FILE_INVALID"]);
    const last = puts.at(-1);
    expect(removed).toContain(`t_${A}:${last?.id}`);
    await o`delete from hub.cc_files where user_id = ${HOA} and seq is null`;
  });
});

describe("CR-161 · công ty thứ ba (C) không chạm được luồng A–B (§5)", () => {
  it("C đọc luồng với A hoặc B ⇒ 404 CONNECT_NO_THREAD; gửi / tải lên ⇒ 409 CONNECT_READ_ONLY; đã đọc ⇒ 0; không tạo luồng/tin/tệp", async () => {
    const [m0, f0, t0] = [
      await nMsgs(),
      await nFiles(),
      await n(o`select count(*)::int as n from hub.cc_threads`),
    ];
    for (const other of [A, B]) {
      const g = await req(CUONG, "GET", `/connect/threads/${other}/messages`);
      expect([g.status, code(g)]).toEqual([404, "CONNECT_NO_THREAD"]);
      const s = await req(CUONG, "POST", `/connect/threads/${other}/messages`, {
        client_id: Bun.randomUUIDv7(),
        body: "chen ngang",
      });
      expect([s.status, code(s)]).toEqual([409, "CONNECT_READ_ONLY"]);
      const u = await req(CUONG, "POST", `/connect/threads/${other}/files`, form("c.pdf"));
      expect([u.status, code(u)]).toEqual([409, "CONNECT_READ_ONLY"]);
      expect(
        (
          await req<{ last_read_seq: number }>(CUONG, "POST", `/connect/threads/${other}/read`, {
            seq: 9,
          })
        ).body.last_read_seq,
      ).toBe(0);
    }
    expect([
      await nMsgs(),
      await nFiles(),
      await n(o`select count(*)::int as n from hub.cc_threads`),
    ]).toEqual([m0, f0, t0]);
    expect(puts.filter((p) => p.org === `t_${C}`)).toHaveLength(0);
  });
});

describe("CR-161 · R8 sau khi ngắt kết nối: chỉ đọc", () => {
  it("Tiên ngắt ⇒ cả hai vẫn đọc tin cũ (read_only=true) và tải tệp cũ; gửi / tải lên ⇒ 409 CONNECT_READ_ONLY, không byte nào lên kho", async () => {
    const d = await req(TIEN, "DELETE", `/connect/links/${B}`);
    expect(d.status).toBe(200);
    const putsBefore = puts.length;
    for (const [u, path] of [
      [TIEN, msgs],
      [DUNG, msgsA],
    ] as const) {
      const p = await req<Page>(u, "GET", path);
      expect([p.status, p.body.read_only, p.body.items.length]).toEqual([200, true, 7]);
    }
    const s = await req(DUNG, "POST", msgsA, {
      client_id: Bun.randomUUIDv7(),
      body: "còn đó không",
    });
    expect([s.status, code(s)]).toEqual([409, "CONNECT_READ_ONLY"]);
    const up = await req(TIEN, "POST", `/connect/threads/${B}/files`, form("sau-ngat.pdf"));
    expect([up.status, code(up)]).toEqual([409, "CONNECT_READ_ONLY"]);
    expect(puts).toHaveLength(putsBefore);
    expect((await req(DUNG, "GET", `/connect/files/${fileId}`)).status).toBe(302);
    expect(
      (
        await req<{ last_read_seq: number }>(DUNG, "POST", `/connect/threads/${A}/read`, {
          seq: 99,
        })
      ).status,
    ).toBe(200);
  });
});

describe("CR-161 · R11 việc nền dọn tệp chưa gắn > 24 h", () => {
  it("chỉ soft-delete + xoá nội dung tệp chưa gắn quá hạn; tệp đã gắn tin / chưa quá hạn giữ nguyên; lượt sau không còn gì", async () => {
    const [old, fresh] = [Bun.randomUUIDv7(), Bun.randomUUIDv7()];
    const [th] = await o<{ id: string }[]>`select id from hub.cc_threads limit 1`;
    await o`insert into hub.cc_files (id, thread_id, tenant_id, user_id, name, mime, size, storage_key, created_at)
      values (${old}, ${th?.id as string}, ${A}, ${TIEN}, 'cu.pdf', 'application/pdf', 5, ${`${A}/${old}`}, now() - interval '25 hours'),
             (${fresh}, ${th?.id as string}, ${A}, ${TIEN}, 'moi.pdf', 'application/pdf', 5, ${`${A}/${fresh}`}, now() - interval '2 hours')`;
    await o`update hub.cc_files set created_at = now() - interval '30 hours' where id = ${fileId}`; // đã gắn tin ⇒ không dọn
    const run = chatFileSweep({
      claim: ccFilesSweepClaim(db),
      store: {
        put: async () => ({ fileId: "", versionId: "" }),
        remove: async (org, id) => void removed.push(`sweep:${org}:${id}`),
        link: async () => null,
      },
    });
    expect(await run()).toBe(1);
    expect(removed.filter((r) => r.startsWith("sweep:"))).toEqual([`sweep:t_${A}:${old}`]);
    const rows = await o<
      { id: string; gone: boolean }[]
    >`select id, deleted_at is not null as gone from hub.cc_files where id in (${old}, ${fresh}, ${fileId})`;
    expect(Object.fromEntries(rows.map((r) => [r.id, r.gone]))).toEqual({
      [old]: true,
      [fresh]: false,
      [fileId]: false,
    });
    expect(await run()).toBe(0);
    expect((await req(TIEN, "GET", `/connect/files/${old}`)).status).toBe(404);
  });
});
