// CR-191 · lát cr191-composer-audience · BR-191-7/8: «@» người của công ty ĐÃ KẾT NỐI nằm trong «Ai thấy bài» (community 0027, DEFINER).
// Route + RLS + chuông thật. N2: người nhắc (hM, nhân viên) KHÁC người tạo/quản trị; chuông tới đúng người (ở tenant CỦA HỌ), không tới người
// đăng, không tới người không được nhắc. Ngoài «Ai thấy bài» / công ty không kết nối / bị chặn ⇒ 422 và bài không được tạo.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { tenants, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../../lib/errors";
import { goodsCatalogModule } from "../../contracts/goods-catalog.mount";
import { pgExternalOrgResolver } from "../../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { packHosts } from "../../kit/adapters/pack-hosts";
import { createPackUow } from "../../kit/adapters/pack-uow";
import { communityModule } from "../community.mount";
import { communityEvents } from "./notify.events";

let own: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
let uC: string; // người của công ty thứ ba, KHÔNG kết nối
let uB2: string; // đồng nghiệp của hB, KHÔNG được nhắc
const F = { read: "pmc-r", write: "pmc-w", admin: "pmc-a", addon: "pmc-ad" };
type Who = "hA" | "hM" | "s1a";
const ORG: Partial<Record<Who, keyof Cast>> = { s1a: "S1" };

const view = (): PackAccessView => ({
  catalog: async () => ({
    features: [
      { id: F.read, key: "contracts-read", status: "on" },
      { id: F.write, key: "contracts-write", status: "on" },
      { id: F.admin, key: "contracts-admin", status: "on" },
      { id: F.addon, key: "contracts-community", status: "on" },
    ],
    entitled: new Set(Object.values(F).map((f) => `${c.A}:${f}`)),
    grantGroups: new Map([
      [`${c.A}:${F.read}`, [c.roles.owner, c.roles.editor]],
      [`${c.A}:${F.write}`, [c.roles.owner, c.roles.editor]],
      [`${c.A}:${F.admin}`, [c.roles.owner]],
    ]),
  }),
  user: async (id) => ({
    tenantId: c.A,
    groupIds: new Set(id === c.hA ? [c.roles.owner] : id === c.hM ? [c.roles.editor] : []),
  }),
});

const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { "x-who": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};
const bells = async (u: string): Promise<string[]> =>
  (
    (await own`select title from hub.notifications where user_id = ${u}::uuid and source = 'community'
      and kind = 'community.mention' order by created_at, id`) as unknown as { title: string }[]
  ).map((r) => r.title);
const aud = (mode: string, tenantsIn: string[] = []) => ({
  mode,
  cats: [],
  companies: [],
  tenants: tenantsIn,
});
const note = (mentionUserIds: string[], audience: unknown, title = "Thông báo chung") => ({
  type: "note",
  title,
  body: "Nhờ các bên xem lịch giao tuần này",
  audience,
  mentionUserIds,
});
const count = async (title: string): Promise<number> => {
  const r =
    (await own`select count(*)::int as n from community.posts where title_raw = ${title}`) as unknown as {
      n: number;
    }[];
  return r[0]?.n ?? 0;
};
const ids = (r: { json: { userId: string }[] }) => r.json.map((p) => p.userId);

beforeAll(async () => {
  await cloneDb("full");
  own = openOwner(2);
  c = await seedCast(own, 57);
  const [tc] = (await tenants(own, 1, 5790)) as [string];
  [uC] = (await users(own, tc as string, 1, { from: 5791 })) as [string];
  [uB2] = (await users(own, c.B, 1, { from: 5792 })) as [string];
  await own`insert into hub.partner_links (from_tenant, to_tenant, accepted_at)
    values (${c.A}, ${c.B}, now()), (${c.B}, ${c.A}, now())`;
  await own`insert into hub.people_profiles (tenant_id, user_id, job_title)
    values (${c.B}, ${c.hB}, 'Trưởng phòng mua hàng')`;
  db = createDb(urls().hubApi, { max: 2 });
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    const org = ORG[who];
    ctx.set("user", {
      userId: c[who],
      tenantId: c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      ...(org ? { userKind: "external", extOrgId: c[org] } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route(
    "/",
    communityModule(db, view(), pgExternalOrgResolver(db), {
      goods: goodsCatalogModule(db, view()),
    }),
  );
  h.onError((e, ctx) => {
    const m = mapError(e);
    return ctx.json(m.body, m.status);
  });
  app = h;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await own?.end({ timeout: 2 });
});

describe("CR-191 · «@» người công ty đã kết nối", () => {
  it("người công ty kết nối ∈ «Tất cả đối tác» ⇒ 201, lưu user_tenant, chuông tới ĐÚNG người (không tới người đăng, đồng nghiệp không được nhắc)", async () => {
    const r = await call("hA", "POST", "/posts", note([c.hB], aud("all")));
    expect(r.status).toBe(201);
    expect(r.json.mentionedUsers.map((m: { userId: string }) => m.userId)).toEqual([c.hB]);
    const t = (await own`select user_tenant::text as t from community.post_mentions
      where post_id = ${r.json.id}::uuid`) as unknown as { t: string }[];
    expect(t[0]?.t).toBe(c.B);
    expect(await bells(c.hB)).toEqual([expect.stringContaining("nhắc bạn")]);
    expect(await bells(uB2)).toHaveLength(0);
    expect(await bells(c.hA)).toHaveLength(0);
    // đối tác ngoài (ext_org) đọc bài: không thấy người công ty khác (RLS post_mentions_visible)
    const seen = await call("s1a", "GET", "/feed");
    expect(seen.status).toBe(200);
    expect(JSON.stringify(seen.json)).toContain(r.json.id); // bài hiện cho đối tác (Tất cả đối tác)
    expect(JSON.stringify(seen.json)).not.toContain(c.hB);
  });

  it("N2 · nhân viên (hM, không phải người tạo/quản trị) nhắc người công ty kết nối khi B ∈ «Chọn công ty» ⇒ 201 + chuông, B không có trong danh sách ⇒ 422, bài không tạo", async () => {
    const ok = await call("hM", "POST", "/posts", note([c.hB], aud("companies", [c.B]), "Chọn B"));
    expect(ok.status).toBe(201);
    expect((await bells(c.hB)).length).toBe(2);
    const no = await call("hM", "POST", "/posts", note([c.hB], aud("companies", []), "Không có B"));
    expect(no.status).toBe(422);
    expect(no.json.error?.code ?? no.json.code).toBe("MENTION_USER_NOT_ALLOWED");
    expect(await count("Không có B")).toBe(0);
    expect((await bells(c.hB)).length).toBe(2);
  });

  it("«Chỉ nội bộ» ⇒ không nhắc được người công ty kết nối (422)", async () => {
    const r = await call("hA", "POST", "/posts", note([c.hB], aud("internal"), "Nội bộ"));
    expect(r.status).toBe(422);
    expect(await count("Nội bộ")).toBe(0);
  });

  it("người công ty KHÔNG kết nối ⇒ 422 dù «Tất cả đối tác»", async () => {
    const r = await call("hA", "POST", "/posts", note([uC], aud("all"), "Công ty lạ"));
    expect(r.status).toBe(422);
    expect(await count("Công ty lạ")).toBe(0);
  });

  it("đối tác ngoài không nhắc được người công ty kết nối (422)", async () => {
    const r = await call("s1a", "POST", "/posts", {
      type: "sell",
      title: "x",
      body: "",
      fields: { product: "Băng keo", qty: "", price: null },
      mentionUserIds: [c.hB],
    });
    expect(r.status).toBe(422);
  });

  it("gợi ý «@»: người công ty kết nối kèm chức vụ + tên công ty khi trong «Ai thấy bài», «Chỉ nội bộ», connected=0, đối tác ngoài ⇒ không có", async () => {
    const ok = await call("hM", "GET", "/mentionable-people?type=note&mode=all");
    const hb = ok.json.find((p: { userId: string }) => p.userId === c.hB);
    expect(hb?.connected).toBe(true);
    expect(hb?.title).toBe("Trưởng phòng mua hàng");
    expect(hb?.orgName).toBeTruthy();
    expect(ids(ok)).not.toContain(uC);
    expect(
      ids(await call("hM", "GET", "/mentionable-people?type=note&mode=internal")),
    ).not.toContain(c.hB);
    expect(
      ids(await call("hM", "GET", "/mentionable-people?type=note&mode=all&connected=0")),
    ).not.toContain(c.hB);
    expect(ids(await call("s1a", "GET", "/mentionable-people"))).not.toContain(c.hB);
  });

  it("«n/N công ty đối tác»: audience-connected trả công ty kết nối + cờ thấy theo chế độ, đối tác ngoài ⇒ rỗng", async () => {
    const all = await call("hM", "GET", "/audience-connected?mode=all");
    expect(all.json).toEqual([expect.objectContaining({ tenantId: c.B, sees: true })]);
    const none = await call("hM", "GET", "/audience-connected?mode=companies");
    expect(none.json).toEqual([expect.objectContaining({ tenantId: c.B, sees: false })]);
    const sel = await call("hM", "GET", `/audience-connected?mode=companies&tenants=${c.B}`);
    expect(sel.json[0].sees).toBe(true);
    expect((await call("s1a", "GET", "/audience-connected?mode=all")).json).toEqual([]);
  });

  it("gợi ý hàng hoá: hàng công ty đã đăng kèm đơn vị + đơn giá, khử trùng, gõ để lọc, đối tác ngoài ⇒ rỗng", async () => {
    for (const n of [1, 2]) {
      const r = await call("hA", "POST", "/posts", {
        type: "sell",
        title: "",
        body: "",
        fields: { product: "Băng keo 5cm", qty: `${100 * n} cuộn`, price: "12000" },
        audience: aud("all"),
      });
      expect(r.status).toBe(201);
    }
    const g = await call("hM", "GET", "/goods-suggest?q=b%C4%83ng");
    expect(g.json).toEqual([
      { name: "Băng keo 5cm", unit: "cuộn", price: "12000", source: "posted" },
    ]);
    expect((await call("hM", "GET", "/goods-suggest?q=zzz")).json).toEqual([]);
    expect((await call("s1a", "GET", "/goods-suggest")).json).toEqual([]);
  });

  it("soát #4 · tenants không phải UUID ⇒ 400 (không chạm SQL)", async () => {
    expect((await call("hM", "GET", "/audience-connected?mode=companies&tenants=abc")).status).toBe(
      400,
    );
    expect(
      (await call("hM", "GET", "/mentionable-people?type=note&mode=companies&tenants=x,y")).status,
    ).toBe(400);
  });

  it("soát #1 · sửa bài thu hẹp «Ai thấy bài» mà không gửi lại danh sách nhắc ⇒ bỏ người công ty kết nối không còn thấy bài", async () => {
    const r = await call("hA", "POST", "/posts", note([c.hB], aud("all"), "Sẽ thu hẹp"));
    expect(r.status).toBe(201);
    const n = async () =>
      (
        (await own`select count(*)::int as n from community.post_mentions where post_id = ${r.json.id}::uuid`) as unknown as {
          n: number;
        }[]
      )[0]?.n;
    expect(await n()).toBe(1);
    // sửa chữ, giữ «Ai thấy bài» (không gửi audience) ⇒ lời nhắc còn
    expect((await call("hM", "PATCH", `/posts/${r.json.id}`, { body: "Đã sửa chữ" })).status).toBe(
      200,
    );
    expect(await n()).toBe(1);
    const up = await call("hM", "PATCH", `/posts/${r.json.id}`, { audience: aud("internal") });
    expect(up.status).toBe(200);
    expect(await n()).toBe(0);
  });

  it("soát #2 · chuông kiểm lại kết nối + «Ai thấy bài» NGAY lúc gửi (kể cả sau duyệt): thu hẹp hoặc ngắt trước khi gửi ⇒ không chuông", async () => {
    const ev = communityEvents({
      uow: createPackUow(db, "community", (tx) => ({ tx })),
      hosts: packHosts(db, view(), "community"),
      orgMembers: (t, ids) => pgExternalOrgResolver(db).orgMembers(t, ids),
    });
    const r = await call("hA", "POST", "/posts", note([c.hB], aud("all"), "Chờ gửi chuông"));
    expect(r.status).toBe(201);
    const send = () =>
      ev.emitPostMentions({
        tenantId: c.A,
        postId: r.json.id,
        actor: { userId: c.hA, name: "A" },
        titleMasked: "Chờ gửi chuông",
      });
    // chuông lúc đăng đã gửi (khoá chống trùng theo bài + người) ⇒ xoá để thử đúng đường «gửi sau» (như sau duyệt)
    await own`delete from hub.notifications where user_id = ${c.hB}::uuid and kind = 'community.mention'`;
    const base = (await bells(c.hB)).length;
    await send(); // còn kết nối + còn trong «Ai thấy bài» ⇒ có chuông
    expect((await bells(c.hB)).length).toBe(base + 1);
    await own`update community.posts set aud_mode = 'internal' where id = ${r.json.id}::uuid`; // thu hẹp trước khi gửi
    await send();
    expect((await bells(c.hB)).length).toBe(base + 1);
    await own`update community.posts set aud_mode = 'all' where id = ${r.json.id}::uuid`;
    await own`update hub.partner_links set blocked_at = now() where from_tenant = ${c.B} and to_tenant = ${c.A}`; // ngắt trước khi gửi
    await send();
    expect((await bells(c.hB)).length).toBe(base + 1);
    await own`update hub.partner_links set blocked_at = null where from_tenant = ${c.B} and to_tenant = ${c.A}`;
  });

  it("gợi ý hàng hoá nối «Sản phẩm & Giá»: Sản phẩm & Giá trước kèm đơn vị + giá gần nhất, bỏ trùng tên với hàng đã đăng, người không có quyền đọc gói ⇒ chỉ hàng đã đăng", async () => {
    await own`insert into contracts.products (tenant_id, name, unit, grp) values
      (${c.A}, 'Băng keo 5cm', 'cuộn', 'goods'), (${c.A}, 'Thùng phi 200L', 'thùng', 'goods')`;
    await own`insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, kind, price, unit, source, seen_on)
      select tenant_id, id, 'NCC', 'new', 9000, 'cuộn', 'manual', current_date - 5 from contracts.products where tenant_id = ${c.A} and name = 'Băng keo 5cm'`;
    await own`insert into contracts.product_supplier_prices (tenant_id, product_id, supplier_name, kind, price, unit, source, seen_on)
      select tenant_id, id, 'NCC', 'new', 15000, 'cuộn', 'manual', current_date from contracts.products where tenant_id = ${c.A} and name = 'Băng keo 5cm'`;
    const g = await call("hM", "GET", "/goods-suggest");
    expect(g.json).toEqual([
      { name: "Băng keo 5cm", unit: "cuộn", price: "15.000", source: "catalog" },
      { name: "Thùng phi 200L", unit: "thùng", source: "catalog" },
    ]);
    expect(
      (await call("hM", "GET", "/goods-suggest?q=thung")).json.map((x: { name: string }) => x.name),
    ).toEqual(["Thùng phi 200L"]);
    expect((await call("s1a", "GET", "/goods-suggest")).json).toEqual([]);
  });

  it("ngắt kết nối (B chặn A) ⇒ nhắc người B ⇒ 422 ngay lần kế", async () => {
    await own`update hub.partner_links set blocked_at = now() where from_tenant = ${c.B} and to_tenant = ${c.A}`;
    const r = await call("hA", "POST", "/posts", note([c.hB], aud("all"), "Sau khi chặn"));
    expect(r.status).toBe(422);
    expect(await count("Sau khi chặn")).toBe(0);
  });
});
