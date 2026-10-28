// CR-102b · com-c7b · nối community ↔ contracts qua cổng (ADR-0031) trên DB thật: Lưu báo giá từ bài Cần bán + từ bình luận NCC trên bài
// Cần mua của chủ quản; đối tác 403; JSON của đối tác giống hệt trước/sau lưu (HT-64/68); gợi ý SHT = MỘT lời gọi cổng mỗi trang (C8).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { enablePack } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../lib/errors";
import type { HostBookReader } from "./community/application/pack-ports";
import { communityModule } from "./community/community.mount";
import { communityPorts } from "./community-wire.mount";
import { pgExternalOrgResolver } from "./kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "./kit/adapters/pack-guard.middleware";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
let reads = 0;
const F = ["c-r", "c-w", "c-a", "k-r", "k-w", "k-a"];
const KEYS = [
  "community-read",
  "community-write",
  "community-admin",
  "contracts-read",
  "contracts-write",
  "contracts-admin",
];

const view = (): PackAccessView => ({
  catalog: async () => ({
    features: F.map((id, i) => ({ id, key: KEYS[i] as string, status: "on" as const })),
    entitled: new Set(F.map((f) => `${c.A}:${f}`)),
    grantGroups: new Map(
      F.map((f, i) => [
        `${c.A}:${f}`,
        i % 3 === 0
          ? [c.roles.owner, c.roles.editor, c.roles.viewer]
          : [c.roles.owner, c.roles.editor],
      ]),
    ),
  }),
  user: async (id) => ({
    tenantId: c.A,
    groupIds: new Set(id === c.hA ? [c.roles.owner] : id === c.hM ? [c.roles.editor] : []),
  }),
});

type Who = "hA" | "hM" | "s1a" | "s2" | "b1";
const ORG: Partial<Record<Who, keyof Cast>> = { s1a: "S1", s2: "S2", b1: "B1" };
function build() {
  const v = view();
  const ports = communityPorts(db, v, { timeZoneOf: async () => "Asia/Ho_Chi_Minh" });
  const hostBook: HostBookReader = {
    read: (who, q) => {
      reads += 1;
      return ports.hostBook.read(who, q);
    },
  };
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
    communityModule(db, v, pgExternalOrgResolver(db), { quotes: ports.quotes, hostBook }),
  );
  h.onError((e, ctx) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return ctx.json(m.body, m.status);
  });
  return h;
}

const call = async (who: Who, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { "x-who": who, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: JSON tự do trong test
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};

const form = (o: Record<string, unknown> = {}) => ({
  newProduct: { name: "Băng keo C7b", unit: "cuộn", group: "goods" },
  price: 12_000,
  unit: "cuộn",
  vatIncluded: true,
  kind: "new",
  quotedAt: "2026-10-28",
  ...o,
});

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 47);
  await enablePack(sql, [c.A], "contracts");
  db = createDb(urls().hubApi, { max: 2 });
  app = build();
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end({ timeout: 2 });
});

const savedProductId = async (): Promise<string> =>
  (
    await sql<{ product_id: string }[]>`select product_id::text from community.quote_saves limit 1`
  )[0]?.product_id as string;

describe("Lưu báo giá + gợi ý SHT (C7b, C8)", () => {
  let sellId = "";
  let partnerBefore = "";

  it("NCC đăng Cần bán; chủ quản lưu báo giá từ bài ⇒ giá nguồn Báo giá + origin_ref, dấu đã lưu chỉ chủ quản", async () => {
    const p = await call("s1a", "POST", "/posts", {
      type: "sell",
      title: "Băng keo",
      fields: { product: "Băng keo C7b", qty: "100 cuộn", price: "12000" },
      cats: ["dong-goi"],
    });
    expect(p.status).toBe(201);
    sellId = p.json.id;
    const feedOf = async (who: Who) =>
      JSON.stringify(
        (await call(who, "GET", "/feed")).json.items.find((i: { id: string }) => i.id === sellId),
      );
    partnerBefore = await feedOf("s1a");
    const pv = await call("hA", "POST", `/posts/${sellId}/quote/preview`, form());
    expect(pv.json.compare).toEqual({ kind: "first" });
    expect(pv.json.existing).toBeNull();
    const r = await call("hA", "POST", `/posts/${sellId}/quote`, form());
    expect(r.status).toBe(201);
    expect(r.json.productCreated).toBe(true);
    const rows =
      await sql`select source, price::int as price, vat_included, origin_ref from contracts.product_supplier_prices
      where tenant_id = ${c.A}::uuid and origin_ref ->> 'post_id' = ${sellId}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "quote", price: 12000, vat_included: true });
    expect(rows[0]?.origin_ref).toMatchObject({ pack: "community", item_idx: 0 });
    const host = (await call("hM", "GET", "/feed")).json.items.find(
      (i: { id: string }) => i.id === sellId,
    );
    expect(host.quotes).toHaveLength(1);
    expect(host.quotes[0]).toMatchObject({
      itemIdx: 0,
      price: 12000,
      postEdited: false,
      priceEdited: false,
    });
    // R28: người sau lưu đè, thấy "đã lưu bởi … lúc …"
    const again = await call(
      "hM",
      "POST",
      `/posts/${sellId}/quote/preview`,
      form({ price: 13_000, newProduct: undefined, productId: await savedProductId() }),
    );
    expect(again.json.existing).toMatchObject({ by: expect.any(String) });
    expect(again.json.replaces).toBe(1);
    expect(await feedOf("s1a")).toBe(partnerBefore); // HT-64: JSON đối tác y hệt trước/sau lưu
  });

  it("NCC sửa giá sau khi lưu ⇒ chủ quản thấy cờ sửa; đối tác không thấy dấu gì (HT-66)", async () => {
    const u = await call("s1a", "PATCH", `/posts/${sellId}`, { fields: { price: "15000" } });
    expect(u.status).toBe(200);
    expect(u.json.quotes).toBeUndefined();
    // C9 wire: người đã lưu (hA) nhận chuông priceEdited; NCC không nhận gì
    const bellOf = async (w: Who) =>
      ((await call(w, "GET", "/notifications")).json.items as { kind: string }[]).map(
        (i) => i.kind,
      );
    expect(await bellOf("hA")).toContain("priceEdited");
    expect(await bellOf("s1a")).not.toContain("priceEdited");
    const host = (await call("hA", "GET", "/feed")).json.items.find(
      (i: { id: string }) => i.id === sellId,
    );
    expect(host.quotes[0]).toMatchObject({ postEdited: true, priceEdited: true });
  });

  it("đối tác (cả NCC chủ bài) 403 ở preview/save/match; JSON đối tác không có quotes/hostHint", async () => {
    for (const who of ["s1a", "s2"] as const) {
      expect((await call(who, "POST", `/posts/${sellId}/quote/preview`, form())).status).toBe(403);
      expect((await call(who, "POST", `/posts/${sellId}/quote`, form())).status).toBe(403);
      expect((await call(who, "GET", "/quote/match?q=Bang")).status).toBe(403);
    }
    const items = (await call("s1a", "GET", "/feed")).json.items as Record<string, unknown>[];
    for (const i of items) {
      expect(i.quotes).toBeUndefined();
      expect(i.hostHint).toBeUndefined();
      expect(i.actions).not.toContain("saveQuote");
    }
  });

  it("lưu từ bình luận NCC trên bài Cần mua của chủ quản; bài Cần bán của chủ quản không lưu được", async () => {
    const buy = await call("hA", "POST", "/posts", {
      type: "buy",
      fields: { product: "Băng keo C7b", qty: "50", area: "HN", neededBy: "2026-11-30" },
      cats: ["dong-goi"],
      audience: { mode: "all" },
    });
    const cm = await call("s1a", "POST", `/posts/${buy.json.id}/comments`, {
      text: "Em báo 11.000đ/cuộn",
    });
    expect(cm.status).toBe(201);
    const commentId = cm.json.comments[0].id;
    const r = await call(
      "hM",
      "POST",
      `/posts/${buy.json.id}/quote`,
      form({
        commentId,
        price: 11_000,
        newProduct: undefined,
        productId: (await call("hA", "GET", "/feed")).json.items.find(
          (i: { id: string }) => i.id === sellId,
        ).quotes[0].productId,
      }),
    );
    expect(r.status).toBe(201);
    expect(r.json.mark.commentId).toBe(commentId);
    const bad = await call("hA", "POST", `/posts/${buy.json.id}/quote`, form());
    expect(bad.status).toBe(422); // thiếu commentId: bài Cần mua chủ quản không phải nguồn
  });

  it("gợi ý SHT: MỘT lời gọi cổng đọc cho cả trang, có khớp SP + giá tốt nhất; đối tác không gọi", async () => {
    reads = 0;
    const r = await call("hA", "GET", "/feed?limit=50");
    expect(reads).toBe(1);
    const sell = r.json.items.find((i: { id: string }) => i.id === sellId);
    expect(sell.hostHint.match.name).toBe("Băng keo C7b");
    expect(sell.hostHint.best.price).toBeGreaterThan(0);
    reads = 0;
    await call("s1a", "GET", "/feed?limit=50");
    expect(reads).toBe(0);
  });

  it("C9 wire: bài Cần mua khớp hàng đang giữ ⇒ chủ quản có quyền đọc SHT nhận matchBuy", async () => {
    const [p] = await sql<
      { id: string }[]
    >`insert into contracts.products (tenant_id, name, unit, grp)
      values (${c.A}::uuid, ${"Mực in C7b"}, ${"hộp"}, ${"goods"}) returning id::text`;
    await sql`insert into contracts.product_components (tenant_id, product_id, ord, name, unit, mode, on_hand, stock_value, avg_cost)
      values (${c.A}::uuid, ${p?.id as string}::uuid, 0, ${"Mực in C7b"}, ${"hộp"}, ${"stock"}, 10, 1000, 100)`;
    const r = await call("b1", "POST", "/posts", {
      type: "buy",
      fields: { product: "Mực in C7b", qty: "5", area: "HN", neededBy: "2026-11-30" },
      cats: ["dong-goi"],
    });
    expect(r.status).toBe(201);
    const kinds = async (w: Who) =>
      ((await call(w, "GET", "/notifications")).json.items as { kind: string; postId?: string }[])
        .filter((i) => i.postId === r.json.id)
        .map((i) => i.kind);
    expect(await kinds("hA")).toEqual(["matchBuy"]);
    expect(await kinds("hM")).toEqual(["matchBuy"]);
  });
});
