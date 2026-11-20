// CR-194 · BR-194-1/2/3 · ảnh/tệp bài công ty ĐÃ KẾT NỐI: bảng tin gộp trả `media` + `GET /files/:id` tải được CHỈ khi người xem THẤY BÀI
// (`community.cross_post_tenant`, 0032; DEFINER `cross_media`/`cross_file` 0033). Role thật `community_rw`. N2: người xem (Vy ở B) KHÔNG phải
// người đăng (Poster ở A). Gọi thẳng service (`feed`, `files.download`) trên DB thật, kho byte giả theo tenant chủ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, inPackAs, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { createPackUow } from "../../kit/public";
import type { CommunityBlobs } from "../application/pack-ports";
import type { Access } from "./community-access";
import { attachableFiles } from "./files.repo";
import * as files from "./files.service";
import { feed } from "./post.service";
import { connectedView } from "./views";

const A = tenantId(1940); // công ty đăng
const B = tenantId(1941); // đã kết nối với A, được bài chọn cho thấy
const C = tenantId(1942); // công ty thứ ba, không kết nối ai
const POSTER = userId(1941);
const VY = userId(1942); // nhân viên B
const UC = userId(1943); // nhân viên C
let o: Sql;
let db: Db;
const fileOf: Record<string, string> = {}; // khoá = tên bài → id tệp

const store = new Map<string, Uint8Array>();
const blobs: CommunityBlobs = {
  put: async () => ({ fileId: "unused", versionId: null }),
  get: async (t, f) => store.get(`${t}/${f}`) ?? null,
  drop: async () => {},
};
const bytes = new TextEncoder().encode("JPEGDATA");

const viewer = (t: string, u: string) =>
  ({
    who: { tenantId: t, userId: u, userKind: "internal" },
    org: null,
    canWrite: true,
    joinAdmin: false,
    dir: { tenantName: "x", userName: "x", orgs: [] },
  }) as unknown as Access;
const uow = () => createPackUow(db, "community", (tx) => ({ tx })) as never;
const F20 = {
  org: null,
  tab: "all" as const,
  cat: null,
  area: null,
  author: null,
  authorUser: null,
  source: null,
  q: null,
  mine: false,
  cursor: null,
  limit: 20,
};
const statusOf = (a: Access, id: string) =>
  files
    .download(uow(), blobs, a, id)
    .then((r) => r.status)
    .catch((e: { status?: number }) => e.status ?? 500);
const status = (t: string, u: string, id: string) => statusOf(viewer(t, u), id);

const post = async (key: string, aud: string, tenants: string[] = []) => {
  const r = await o<{ id: string }[]>`insert into community.posts
    (tenant_id, type, author_user_id, author_name, status, title_raw, title_masked, body_raw, body_masked, fields_raw, fields_masked,
     hits, cats, aud_mode, aud_orgs, aud_tenants, expires_at)
    values (${A}, 'note', ${POSTER}, 'Lan Poster', 'active', ${key}, ${key}, 'b', 'b', ${o.json({})}, ${o.json({})}, ${o.json([])},
      ${o.array([])}, ${aud}, ${o.array([])}::uuid[], ${o.array(tenants)}::uuid[], now() + interval '30 days')
    returning id`;
  const pid = r[0]?.id as string;
  const f = await o<{ id: string }[]>`insert into community.files
    (tenant_id, org, file_id, name, mime, size_bytes, created_by)
    values (${A}, ${`t_${A}`}, ${`fb-${key}`}, ${`${key}.jpg`}, 'image/jpeg', ${bytes.length}, ${POSTER}) returning id`;
  fileOf[key] = f[0]?.id as string;
  store.set(`${A}/fb-${key}`, bytes);
  await o`insert into community.media (tenant_id, post_id, kind, position, label, file_id, name, mime, size_bytes)
    values (${A}, ${pid}, 'image', 0, 'ảnh', ${fileOf[key] as string}, ${`${key}.jpg`}, 'image/jpeg', ${bytes.length})`;
};

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  await o`insert into hub.partner_links (from_tenant, to_tenant, accepted_at) values (${A}, ${B}, now()), (${B}, ${A}, now())`;
  await o`insert into admin.tenants (id, key, name, legal_name, tax_code)
    select t.id, 'cm' || t.n, 'cm' || t.n, t.ln, t.mst from unnest(${o.array([A, B, C])}::uuid[],
      ${o.array(["Công ty A", "Công ty B", "Công ty C"])}::text[], ${o.array(["0100001940", "0100001941", "0100001942"])}::text[])
      with ordinality as t(id, ln, mst, n)`;
  await o`insert into admin.feature_entitlements (feature_id, tenant_id)
    select f.id, t from admin.features f, unnest(${o.array([A, B, C])}::uuid[]) t where f.key = 'contracts-community'
    on conflict (feature_id, tenant_id) do update set revoked_at = null`;
  await users(o, B, 1, { from: 1942 });
  await users(o, C, 1, { from: 1943 });
  await post("cho_thay", "all"); // «Tất cả đối tác»: B thấy
  await post("chon_B", "companies", [B]);
  await post("khong_cho_B", "companies", [C]); // B kết nối nhưng bài không chọn B
  await post("noi_bo", "internal");
  db = createDb(urls().hubApi, { max: 2 });
}, 60_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-194 · ảnh/tệp bài công ty đã kết nối", () => {
  it("(a) Vy (B, không phải người đăng) thấy media của bài được cho thấy, đúng khuôn MediaItem, và tải được tệp (200 + byte)", async () => {
    const out = await feed(uow(), viewer(B, VY), F20);
    const byTitle = new Map(out.connected.map((r) => [r.title, r]));
    expect([...byTitle.keys()].sort()).toEqual(["chon_B", "cho_thay"].sort());
    const v = connectedView(byTitle.get("cho_thay") as never);
    expect(v.media).toEqual([
      {
        id: expect.any(String),
        kind: "image",
        label: "ảnh",
        fileId: fileOf.cho_thay as string,
        name: "cho_thay.jpg",
        size: bytes.length,
        mime: "image/jpeg",
      },
    ]);
    expect(v.fileCount).toBe(1);
    const res = await files.download(uow(), blobs, viewer(B, VY), fileOf.cho_thay as string);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(await status(B, VY, fileOf.chon_B as string)).toBe(200);
  });

  it("(b) B kết nối nhưng bài không cho thấy ⇒ không có bài, tải tệp 404 (giống tệp không tồn tại); bài nội bộ cũng vậy", async () => {
    const out = await feed(uow(), viewer(B, VY), F20);
    expect(out.connected.map((r) => r.title)).not.toContain("khong_cho_B");
    expect(await status(B, VY, fileOf.khong_cho_B as string)).toBe(404);
    expect(await status(B, VY, fileOf.noi_bo as string)).toBe(404);
    expect(await status(B, VY, crypto.randomUUID())).toBe(404);
  });

  it("(b2) ngắt kết nối hoặc A tắt Bảng tin ⇒ tệp mất ngay (kiểm lại mỗi lần)", async () => {
    await o`update hub.partner_links set accepted_at = null where from_tenant = ${A} and to_tenant = ${B}`;
    expect(await status(B, VY, fileOf.cho_thay as string)).toBe(404);
    await o`update hub.partner_links set accepted_at = now() where from_tenant = ${A} and to_tenant = ${B}`;
    expect(await status(B, VY, fileOf.cho_thay as string)).toBe(200);
    await o`update admin.feature_entitlements e set revoked_at = now() from admin.features f
      where f.id = e.feature_id and f.key = 'contracts-community' and e.tenant_id = ${A}`;
    expect(await status(B, VY, fileOf.cho_thay as string)).toBe(404);
    await o`update admin.feature_entitlements e set revoked_at = null from admin.features f
      where f.id = e.feature_id and f.key = 'contracts-community' and e.tenant_id = ${A}`;
  });

  it("(c) công ty không kết nối (C) ⇒ feed rỗng, mọi tệp 404 kể cả bài «Tất cả đối tác»", async () => {
    const out = await feed(uow(), viewer(C, UC), F20);
    expect(out.connected).toEqual([]);
    expect(await status(C, UC, fileOf.cho_thay as string)).toBe(404);
    expect(await status(C, UC, fileOf.khong_cho_B as string)).toBe(404);
  });

  it("(c2) người dùng ngoài (đối tác cộng đồng) không đi đường chéo công ty ⇒ 404", async () => {
    const a = { ...viewer(B, VY), org: crypto.randomUUID() } as Access;
    expect(await statusOf(a, fileOf.cho_thay as string)).toBe(404);
  });

  it("(d) đối tác chỉ xem: không sửa/xoá hàng tệp, không sửa/xoá media của A, không gắn tệp của A vào bài mình", async () => {
    const f = fileOf.cho_thay as string;
    const res = await inPackAs("community", B, VY, async (tx) => ({
      upd: await tx`update community.files set deleted_at = now() where id = ${f} returning id`,
      del: await tx`delete from community.media where file_id = ${f} returning id`,
      updMedia: await tx`update community.media set label = 'x' where file_id = ${f} returning id`,
    }));
    const attach = await createPackUow(db, "community", (tx) => ({ tx })).tenant(
      { tenantId: B, userId: VY } as never,
      ({ tx }) => attachableFiles(tx, B, [f], VY, null),
    );
    expect([res.upd.length, res.del.length, res.updMedia.length, attach.length]).toEqual([
      0, 0, 0, 0,
    ]);
    const still =
      await o`select count(*)::int as n from community.files f join community.media m on m.file_id = f.id
      where f.id = ${f} and f.deleted_at is null`;
    expect(still[0]?.n).toBe(1);
    expect(await status(B, VY, f)).toBe(200);
  });
});
