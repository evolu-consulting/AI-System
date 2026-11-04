// CR-118 · cr118-community-files · §11.1 "Đính kèm" trên DB thật (RLS gói): `POST /files` (sniff nội dung, không tin đuôi; trần
// `ATTACH_MAX_BYTES`) + `GET /files/:id` chỉ cho người XEM ĐƯỢC BÀI chứa tệp (cùng luật `posts_visible`, gồm đối tác) hoặc chính
// người tải lên; còn lại 404 giống hệt. Test viết TRƯỚC code (Luật 1b: RLS/cách ly).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ATTACH_MAX_BYTES } from "@ai/contracts";
import { CommunityFileSchema, PostViewSchema } from "@ai/contracts/community";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import {
  type Cast,
  seedCast,
  seedPosts,
} from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import type { CommunityBlobs } from "../application/pack-ports";
import { communityModule } from "../community.mount";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
const F = ["c-r", "c-w", "c-a"];
const KEYS = ["community-read", "community-write", "community-admin"];

const view = (): PackAccessView => ({
  catalog: async () => ({
    features: F.map((id, i) => ({ id, key: KEYS[i] as string, status: "on" as const })),
    entitled: new Set(F.flatMap((f) => [`${c.A}:${f}`, `${c.B}:${f}`])),
    grantGroups: new Map(
      F.flatMap((f) => [
        [`${c.A}:${f}`, [c.roles.owner, c.roles.editor]],
        [`${c.B}:${f}`, ["gB"]],
      ]),
    ),
  }),
  user: async (id) =>
    id === c.hB
      ? { tenantId: c.B, groupIds: new Set(["gB"]) }
      : {
          tenantId: c.A,
          groupIds: new Set(id === c.hA ? [c.roles.owner] : id === c.hM ? [c.roles.editor] : []),
        },
});

/** Kho byte giả theo org tenant (thay FileBox `t_<tenant>`): khoá = org + fileId ⇒ chéo tenant không bao giờ khớp. */
const store = new Map<string, Uint8Array>();
let seq = 0;
const blobs: CommunityBlobs = {
  put: async (tenantId, _name, bytes) => {
    const fileId = `fb-${++seq}`;
    store.set(`${tenantId}/${fileId}`, bytes);
    return { fileId, versionId: "v1" };
  },
  get: async (tenantId, fileId) => store.get(`${tenantId}/${fileId}`) ?? null,
  drop: async (tenantId, fileId) => {
    store.delete(`${tenantId}/${fileId}`);
  },
};

type Who = "hA" | "hM" | "hB" | "s1a" | "s2";
function build() {
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    const ext = who === "s1a" ? c.S1 : who === "s2" ? c.S2 : null;
    ctx.set("user", {
      userId: c[who],
      tenantId: who === "hB" ? c.B : c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      ...(ext ? { userKind: "external", extOrgId: ext } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route("/", communityModule(db, view(), pgExternalOrgResolver(db), { blobs }));
  h.onError((e, ctx) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return ctx.json(m.body, m.status);
  });
  return h;
}

const enc = new TextEncoder();
const PDF = enc.encode("%PDF-1.7\n1 0 obj << >> endobj\ntrailer\n%%EOF\n");

const upload = async (who: Who, name: string, bytes: Uint8Array) => {
  const res = await app.request("/files", {
    method: "POST",
    headers: { "x-who": who, "x-filename": encodeURIComponent(name) },
    body: bytes,
  });
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: JSON tự do trong test
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};
const uploaded = async (who: Who, name: string, bytes: Uint8Array) => {
  const r = await upload(who, name, bytes);
  expect({ status: r.status, err: r.status === 201 ? null : r.json }).toEqual({
    status: 201,
    err: null,
  });
  return CommunityFileSchema.parse(r.json);
};
const download = (who: Who, id: string) =>
  app.request(`/files/${id}`, { headers: { "x-who": who } });
const createPost = async (who: Who, body: unknown) => {
  const res = await app.request("/posts", {
    method: "POST",
    headers: { "x-who": who, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: JSON tự do trong test
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};
const note = (fileId: string, aud?: unknown) => ({
  type: "note",
  body: "Bảng giá tháng 11",
  media: [{ id: "x", kind: "file", label: "", fileId }],
  ...(aud ? { audience: aud } : {}),
});

let shared = ""; // tệp trên bài chủ quản audience=all
let narrow = ""; // tệp trên bài chủ quản chỉ cho công ty B1
let s2File = ""; // tệp trên bài của đối tác S2

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 71);
  db = createDb(urls().hubApi, { max: 2 });
  app = build();
  shared = (await uploaded("hA", "bang-gia.pdf", PDF)).id;
  const p1 = await createPost("hA", note(shared, { mode: "all", cats: [], companies: [] }));
  expect(p1.status).toBe(201);
  narrow = (await uploaded("hA", "rieng.pdf", PDF)).id;
  const p2 = await createPost(
    "hA",
    note(narrow, { mode: "companies", cats: [], companies: [c.B1] }),
  );
  expect(p2.status).toBe(201);
  // Bài đối tác S2 (seed thẳng) + tệp của S2 gắn vào bài đó.
  const s = await seedPosts(sql, c.A, [{ key: "S2-p", type: "sell", org: c.S2, author: c.s2 }]);
  const put = await blobs.put(c.A, "s2.pdf", PDF);
  const [row] = await sql<{ id: string }[]>`insert into community.files
      (tenant_id, org, file_id, version_id, name, mime, size_bytes, created_by)
    values (${c.A}, ${`t_${c.A}`}, ${put.fileId}, 'v1', 's2.pdf', 'application/pdf', ${PDF.length}, ${c.s2})
    returning id::text as id`;
  s2File = row?.id as string;
  await sql`insert into community.media (tenant_id, post_id, position, kind, label, file_id, name, mime, size_bytes)
    values (${c.A}, ${s.get("S2-p") as string}, 0, 'file', '', ${s2File}, 's2.pdf', 'application/pdf', ${PDF.length})`;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("POST /files — sniff nội dung + trần cỡ (CR-118 §11.1)", () => {
  it("[CR-118] PDF thật ⇒ 201 {id,name,mime,size}; mime theo nội dung", async () => {
    const f = await uploaded("hM", "../../Hợp đồng‮.pdf", PDF);
    expect(f.mime).toBe("application/pdf");
    expect(f.size).toBe(PDF.length);
    expect(f.name).toBe("Hợp đồng.pdf");
  });

  it("[CR-118] exe/html đội lốt .pdf, html đội lốt .txt, đuôi lạ ⇒ 415", async () => {
    const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);
    expect((await upload("hA", "hoa-don.pdf", exe)).status).toBe(415);
    const html = enc.encode("<!DOCTYPE html><html><script>alert(1)</script></html>");
    expect((await upload("hA", "hoa-don.pdf", html)).status).toBe(415);
    expect((await upload("hA", "ghi-chu.txt", html)).status).toBe(415);
    expect((await upload("hA", "setup.exe", exe)).status).toBe(415);
  });

  it("[CR-118] quá ATTACH_MAX_BYTES ⇒ 413; thiếu tên ⇒ 400", async () => {
    const big = new Uint8Array(ATTACH_MAX_BYTES + 1);
    big.set(PDF);
    const r = await upload("hA", "to.pdf", big);
    expect(r.status).toBe(413);
    const res = await app.request("/files", {
      method: "POST",
      headers: { "x-who": "hA" },
      body: PDF,
    });
    expect(res.status).toBe(400);
  });
});

describe("Bài kèm tệp — PostView (CR-118 §11.1)", () => {
  it("[CR-118] media kind=file mang fileId/name/size/mime; dùng fileId của người khác ⇒ 400", async () => {
    const f = await uploaded("hA", "catalog.pdf", PDF);
    const r = await createPost("hA", note(f.id));
    expect(r.status).toBe(201);
    const m = PostViewSchema.parse(r.json).media[0];
    expect(m).toMatchObject({ kind: "file", fileId: f.id, name: "catalog.pdf", size: PDF.length });
    expect(m?.mime).toBe("application/pdf");
    const other = await uploaded("hA", "cua-hA.pdf", PDF);
    expect((await createPost("hM", note(other.id))).status).toBe(400);
    expect((await createPost("hM", note(shared))).status).toBe(400); // tệp đã trên bài khác
    expect(
      (await createPost("hM", { ...note(f.id), media: [{ id: "x", kind: "file", label: "" }] }))
        .status,
    ).toBe(400);
  });
});

describe("GET /files/:id — chỉ người xem được bài (CR-118 §11.1, RLS posts_visible)", () => {
  it("[CR-118] thành viên cùng tenant + đối tác trong audience tải được: attachment + nosniff", async () => {
    for (const who of ["hA", "hM", "s1a"] as const) {
      const res = await download(who, shared);
      expect(res.status).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);
      expect(res.headers.get("content-type")).toBe("application/pdf");
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
      expect(res.headers.get("content-disposition")).toStartWith("attachment;");
      expect(res.headers.get("content-disposition")).toContain("bang-gia.pdf");
    }
  });

  it("[CR-118] đối tác không thấy bài ⇒ 404; bài đối tác khác ⇒ 404; chủ quản thấy bài đối tác", async () => {
    expect((await download("s1a", narrow)).status).toBe(404);
    expect((await download("s1a", s2File)).status).toBe(404);
    expect((await download("s2", s2File)).status).toBe(200);
    expect((await download("hM", s2File)).status).toBe(200);
  });

  it("[CR-118] tenant khác ⇒ 404; tệp chưa gắn bài của người khác ⇒ 404; id rác ⇒ 404", async () => {
    expect((await download("hB", shared)).status).toBe(404);
    const loose = await uploaded("hA", "nhap.pdf", PDF);
    expect((await download("hA", loose.id)).status).toBe(200);
    expect((await download("hM", loose.id)).status).toBe(404);
    expect((await download("s1a", loose.id)).status).toBe(404);
    expect((await download("hA", "khong-phai-uuid")).status).toBe(404);
  });
});
