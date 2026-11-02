// CR-110 · cr110-ports · COM-FR-43 (caps) · COM-FR-45 (brand) · ADR-0031 trên DB thật: `GET /viewer` có `caps.contracts` +
// `contractsUrl` theo quyền gói contracts (đối tác luôn false/null); `GET /brand` = brand công ty CHỦ QUẢN cho mọi account trong
// tenant (đối tác chỉ 4 trường); tenant khác không đọc được brand của nhau. Test viết TRƯỚC code (Luật 1b: tenant/quyền).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CommunityBrandSchema, CommunityViewerSchema } from "@ai/contracts/community";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../lib/errors";
import { communityModule } from "./community/community.mount";
import { communityPorts } from "./community-wire.mount";
import { pgExternalOrgResolver } from "./kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "./kit/adapters/pack-guard.middleware";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
const SHT = "https://sht.example.test";
const LOGO = "data:image/png;base64,iVBORw0KGgo=";
const F = ["c-r", "c-w", "c-a", "k-r", "k-w", "k-a"];
const KEYS = [
  "community-read",
  "community-write",
  "community-admin",
  "contracts-read",
  "contracts-write",
  "contracts-admin",
];

/** Community read/write: owner + editor, admin: owner (A); nhóm `gB` (B). Contracts: CHỈ owner (A) ⇒ hM có community nhưng không có contracts. */
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
  h.route(
    "/",
    communityModule(db, v, pgExternalOrgResolver(db), {
      shtUrl: SHT,
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

const call = async (who: Who, path: string, tenant?: string) => {
  const res = await app.request(path, {
    headers: { "x-who": who, ...(tenant ? { "x-tenant": tenant } : {}) },
  });
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: JSON tự do trong test
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 53);
  await sql`insert into contracts.company_settings (tenant_id, company_name, app_name, logo, accent, theme,
      own_names, own_tax_ids)
    values (${c.A}::uuid, 'Công ty Chủ Quản A', 'Sổ A', ${LOGO}, 'rose', 'dark', '{"Pháp nhân A"}', '{"0101234567"}'),
      (${c.B}::uuid, 'Công ty B', null, null, 'teal', 'auto', '{}', '{}')`;
  db = createDb(urls().hubApi, { max: 2 });
  app = build();
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("viewer.caps.contracts + contractsUrl (COM-FR-43)", () => {
  it("[COM-FR-43] admin chủ quản có quyền contracts ⇒ caps.contracts true + contractsUrl", async () => {
    const r = await call("hA", "/viewer");
    expect(r.status).toBe(200);
    const v = CommunityViewerSchema.parse(r.json);
    expect(v.caps).toEqual({ contracts: true });
    expect(v.contractsUrl).toBe(SHT);
  });

  it("[COM-FR-43] thành viên chủ quản không có quyền contracts ⇒ caps false, contractsUrl null", async () => {
    const v = CommunityViewerSchema.parse((await call("hM", "/viewer")).json);
    expect(v.role).toBe("host_member");
    expect(v.caps).toEqual({ contracts: false });
    expect(v.contractsUrl).toBeNull();
  });

  it("[COM-FR-43] đối tác ⇒ caps false, contractsUrl null (I1)", async () => {
    const v = CommunityViewerSchema.parse((await call("s1a", "/viewer")).json);
    expect(v.role).toBe("partner");
    expect(v.caps).toEqual({ contracts: false });
    expect(v.contractsUrl).toBeNull();
  });
});

describe("GET /brand (COM-FR-45)", () => {
  const hostBrand = {
    name: "Công ty Chủ Quản A",
    appName: "Sổ A",
    logo: LOGO,
    accent: "rose" as const,
  };

  it("[COM-FR-45] chủ quản đọc brand công ty mình từ /company", async () => {
    const r = await call("hM", "/brand");
    expect(r.status).toBe(200);
    expect(CommunityBrandSchema.parse(r.json)).toEqual(hostBrand);
  });

  it("[COM-FR-45] đối tác đọc brand CHỦ QUẢN, đúng 4 trường (không pháp nhân/MST/giao diện/cờ)", async () => {
    const r = await call("s1a", "/brand");
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(["accent", "appName", "logo", "name"]);
    expect(r.json).toEqual(hostBrand);
    expect(JSON.stringify(r.json)).not.toMatch(/0101234567|Pháp nhân|dark|version/);
  });

  it("[COM-FR-45] ETag mạnh + Cache-Control private, If-None-Match khớp ⇒ 304, đối tác vẫn đúng 4 trường", async () => {
    const first = await app.request("/brand", { headers: { "x-who": "s1a" } });
    expect(first.status).toBe(200);
    const etag = first.headers.get("etag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(first.headers.get("cache-control")).toBe("private, max-age=300");
    expect(Object.keys((await first.json()) as object).sort()).toEqual([
      "accent",
      "appName",
      "logo",
      "name",
    ]);
    const second = await app.request("/brand", {
      headers: { "x-who": "s1a", "if-none-match": etag },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
    const stale = await app.request("/brand", {
      headers: { "x-who": "s1a", "if-none-match": '"stale"' },
    });
    expect(stale.status).toBe(200);
  });

  it("[COM-FR-45] chặn chéo tenant: B chỉ thấy brand B; user A mang tenant B ⇒ 403", async () => {
    const b = await call("hB", "/brand");
    expect(b.status).toBe(200);
    expect(b.json).toEqual({ name: "Công ty B", appName: null, logo: null, accent: "teal" });
    const spoof = await call("hA", "/brand", c.B);
    expect(spoof.status).toBe(403);
    expect(JSON.stringify(spoof.json)).not.toContain("Chủ Quản A");
  });

  it("[COM-FR-45] chưa có brand ⇒ tên tenant + indigo, không lỗi (P5-AC07)", async () => {
    await sql`delete from contracts.company_settings where tenant_id = ${c.B}::uuid`;
    const r = await call("hB", "/brand");
    expect(r.status).toBe(200);
    const b = CommunityBrandSchema.parse(r.json);
    expect(b).toMatchObject({ appName: null, logo: null, accent: "indigo" });
    expect(b.name.length).toBeGreaterThan(0);
  });
});
