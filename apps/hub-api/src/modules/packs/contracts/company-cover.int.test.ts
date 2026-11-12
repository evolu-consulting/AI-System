// CR-138 · Q8/Q9 · int (DB thật): màu chủ đạo tự chọn + ảnh bìa công ty lưu cạnh logo (`contracts.company_settings`).
// (1) đường chính: chủ sở hữu PUT /company (cover + hex) ⇒ GET /company chỉ báo `has_cover` (không kèm ảnh), `/company/cover` trả ảnh,
//     đối tác đọc `/brand/cover` của chủ quản, `/brand` vẫn đúng 4 trường (hex ⇒ community dùng indigo = --primary của brand);
// (2) không phải chủ sở hữu ⇒ 403 và dữ liệu không đổi; (3) chéo tenant: B không thấy ảnh bìa của A; user A mang tenant B ⇒ 403.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../lib/errors";
import { communityModule } from "../community/community.mount";
import { communityPorts } from "../community-wire.mount";
import { pgExternalOrgResolver } from "../kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { companyModule } from "./company.mount";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
const COVER = `data:image/png;base64,${"iVBORw0KGgo".repeat(8)}AAAA`;
const F = ["c-ad", "k-r", "k-w", "k-a"];
const KEYS = ["contracts-community", "contracts-read", "contracts-write", "contracts-admin"];

/** Owner (A): đủ quyền (admin). Editor (A, `hM`): đọc/ghi gói nhưng KHÔNG có contracts-admin. Nhóm gB: tenant B. */
const view = (): PackAccessView => ({
  catalog: async () => ({
    features: F.map((id, i) => ({ id, key: KEYS[i] as string, status: "on" as const })),
    entitled: new Set(F.flatMap((f) => [`${c.A}:${f}`, `${c.B}:${f}`])),
    grantGroups: new Map(
      F.flatMap((f, i) => [
        [`${c.A}:${f}`, i < 2 ? [c.roles.owner, c.roles.editor] : [c.roles.owner]],
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

type Who = "hA" | "hM" | "hB" | "s1a";
function build() {
  const v = view();
  const ports = communityPorts(db, v, { timeZoneOf: async () => "Asia/Ho_Chi_Minh" });
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    const tenant = ctx.req.header("x-tenant");
    ctx.set("user", {
      userId: c[who],
      tenantId: tenant ?? (who === "hB" ? c.B : c.A),
      role: who === "hA" ? "tenant_admin" : "member",
      ...(who === "s1a" ? { userKind: "external", extOrgId: c.S1 } : { userKind: "internal" }),
    } as never);
    await next();
  });
  h.route("/c", companyModule(db, v));
  h.route(
    "/",
    communityModule(db, v, pgExternalOrgResolver(db), {
      shtUrl: "https://sht.example.test",
      brand: ports.brand,
      caps: ports.caps,
    }),
  );
  h.onError((e, ctx) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return ctx.json(m.body, m.status);
  });
  return h;
}

const call = async (who: Who, path: string, init?: { body?: unknown; tenant?: string }) => {
  const res = await app.request(path, {
    method: init?.body === undefined ? "GET" : "PUT",
    headers: {
      "x-who": who,
      ...(init?.tenant ? { "x-tenant": init.tenant } : {}),
      ...(init?.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: JSON tự do trong test
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};
const base = {
  name: null,
  app_name: null,
  logo: null,
  accent: "indigo",
  theme: "auto",
  own_names: [],
  own_tax_ids: [],
};

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 54);
  db = createDb(urls().hubApi, { max: 2 });
  app = build();
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("CR-138 · ảnh bìa + màu tự chọn", () => {
  it("không phải chủ sở hữu ⇒ 403, dữ liệu không đổi", async () => {
    const r = await call("hM", "/c/company", {
      body: { ...base, cover: COVER, accent: "#4f46e5" },
    });
    expect(r.status).toBe(403);
    expect((await call("hA", "/c/company/cover")).json).toEqual({ cover: null });
  });

  it("thân sai (SVG làm bìa, hex nhạt) ⇒ 400/422 và không lưu", async () => {
    const svg = await call("hA", "/c/company", {
      body: { ...base, cover: "data:image/svg+xml;base64,AAAA" },
    });
    expect(svg.status).toBeGreaterThanOrEqual(400);
    expect(svg.status).toBeLessThan(500);
    const pale = await call("hA", "/c/company", { body: { ...base, accent: "#ffee00" } });
    expect(pale.status).toBeGreaterThanOrEqual(400);
    expect(pale.status).toBeLessThan(500);
    expect((await call("hA", "/c/company/cover")).json).toEqual({ cover: null });
  });

  it("chủ sở hữu lưu cover + hex ⇒ has_cover, ảnh ở /company/cover, đối tác đọc /brand/cover, /brand vẫn 4 trường", async () => {
    const put = await call("hA", "/c/company", {
      body: { ...base, cover: COVER, accent: "#1D4ED8" },
    });
    expect(put.status).toBe(200);
    expect(put.json.company.accent).toBe("#1d4ed8");
    expect(put.json.company.has_cover).toBe(true);
    expect(JSON.stringify(put.json)).not.toContain(COVER); // ảnh không kèm ở /company
    expect((await call("hM", "/c/company")).json.company.has_cover).toBe(true);
    expect((await call("hM", "/c/company/cover")).json).toEqual({ cover: COVER });
    expect((await call("s1a", "/brand/cover")).json).toEqual({ cover: COVER });
    const brand = await call("s1a", "/brand");
    expect(Object.keys(brand.json).sort()).toEqual(["accent", "appName", "logo", "name"]);
    expect(brand.json.accent).toBe("indigo"); // hex tự chọn: community dùng --primary do brand toàn app đặt
  });

  it("PUT không gửi `cover` ⇒ giữ ảnh, gửi null ⇒ xoá", async () => {
    const keep = await call("hA", "/c/company", { body: { ...base, accent: "teal" } });
    expect(keep.json.company.has_cover).toBe(true);
    expect((await call("hA", "/c/company/cover")).json).toEqual({ cover: COVER });
    const del = await call("hA", "/c/company", { body: { ...base, accent: "teal", cover: null } });
    expect(del.json.company.has_cover).toBe(false);
    expect((await call("s1a", "/brand/cover")).json).toEqual({ cover: null });
    await call("hA", "/c/company", { body: { ...base, cover: COVER } }); // dựng lại cho ca chéo tenant
  });

  it("chéo tenant: B không thấy ảnh bìa của A, user A mang tenant B ⇒ 403", async () => {
    expect((await call("hB", "/brand/cover")).json).toEqual({ cover: null });
    expect((await call("hB", "/c/company/cover")).json).toEqual({ cover: null });
    const spoof = await call("hA", "/brand/cover", { tenant: c.B });
    expect(spoof.status).toBe(403);
    expect(JSON.stringify(spoof.json)).not.toContain("iVBOR");
  });
});
