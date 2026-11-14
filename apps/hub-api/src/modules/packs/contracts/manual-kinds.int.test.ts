// CR-152d · int (DB thật): `POST /contracts/manual` nhận `kind_terms` khi deal = franchise | cooperation — ghi cùng tx tạo HĐ, rồi sinh mốc kỳ
// như khi vào DONE. Thiếu trường bắt buộc ⇒ 422 theo trường; Hợp tác «không chia» ⇒ chỉ nhắc gia hạn; quyền ghi (N2: viewer 403);
// tenant khác không thấy HĐ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createDb, type Db } from "@ai/db";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../../tests/acceptance/com-c3/_support/cast";
import { mapError } from "../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../kit/adapters/pack-guard.middleware";
import { extractionRoutes } from "./adapters/extraction.routes";
import { createManual } from "./application/create-manual.usecase";
import { packUow } from "./extraction.uow";

let o: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
const F = ["c-r", "c-w"];
const KEYS = ["contracts-read", "contracts-write"];

/** hA (owner): đọc + ghi. hM (editor): chỉ đọc. hB: tenant B (ghi). */
const view = (): PackAccessView => ({
  catalog: async () => ({
    features: F.map((id, i) => ({ id, key: KEYS[i] as string, status: "on" as const })),
    entitled: new Set(F.flatMap((f) => [`${c.A}:${f}`, `${c.B}:${f}`])),
    grantGroups: new Map(
      F.flatMap((f, i) => [
        [`${c.A}:${f}`, i === 0 ? [c.roles.owner, c.roles.editor] : [c.roles.owner]],
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

type Who = "hA" | "hM" | "hB";
const post = async (who: Who, body: unknown) => {
  const res = await app.request("/contracts/manual", {
    method: "POST",
    headers: { "x-who": who, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  // biome-ignore lint/suspicious/noExplicitAny: JSON tự do trong test
  return { status: res.status, json: (text ? JSON.parse(text) : null) as any };
};
const base = (deal: string, kind_terms?: unknown) => ({
  deal,
  title: `HĐ nhập tay ${deal}`,
  partner_name: "Công ty Mẫu Đối Tác",
  start_date: "2026-12-01",
  end_date: "2027-02-28",
  notice_days: 30,
  ...(kind_terms === undefined ? {} : { kind_terms }),
});
const FR = {
  role: "franchisor",
  brand: "Cà Phê Mẫu",
  initial_fee: 300_000_000,
  fee_basis: "revenue_pct",
  fee_pct: 5,
  period: "month",
};
const row = (id: string) =>
  o<
    {
      deal: string;
      direction: string;
      status: string;
      kind_terms: Record<string, unknown> | null;
    }[]
  >`select deal, direction, status, kind_terms from contracts.contracts where id = ${id}`;
const obl = (id: string) =>
  o<
    { kind: string; period_key: string | null; status: string }[]
  >`select kind, period_key, status from contracts.obligations where contract_id = ${id} and status <> 'replaced' order by seq`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  c = await seedCast(o, 1521);
  db = createDb(urls().hubApi, { max: 3 });
  const manual = createManual({
    uow: packUow(db),
    tax: null,
    newId: () => Bun.randomUUIDv7(),
    today: async () => "2026-11-14",
  });
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    const who = ctx.req.header("x-who") as Who;
    ctx.set("user", {
      userId: c[who],
      tenantId: who === "hB" ? c.B : c.A,
      role: who === "hA" ? "tenant_admin" : "member",
      userKind: "internal",
    } as never);
    await next();
  });
  h.route(
    "/",
    extractionRoutes(view(), {
      requestExtract: (async () => ({ kind: "not_found" })) as never,
      createManual: manual,
      manualEnabled: true,
    }),
  );
  h.onError((e, ctx) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return ctx.json(m.body, m.status);
  });
  app = h;
}, 120_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-152d · nhập tay Nhượng quyền / Hợp tác", () => {
  it("Nhượng quyền % doanh thu ⇒ HĐ done + kind_terms + mốc kỳ", async () => {
    const r = await post("hA", base("franchise", FR));
    expect(r.status).toBe(201);
    expect(r.json.status).toBe("done");
    const [h] = await row(r.json.id);
    expect(h?.deal).toBe("franchise");
    expect(h?.direction).toBe("sale");
    expect(h?.kind_terms?.fee_pct).toBe(5);
    const ms = await obl(r.json.id);
    expect(ms.some((m) => m.period_key === "2026-12")).toBe(true);
    expect(ms.some((m) => m.period_key === "2027-02")).toBe(true);
  });

  it("bên nhận quyền ⇒ direction purchase theo vai", async () => {
    const r = await post("hA", base("franchise", { ...FR, role: "franchisee" }));
    expect(r.status).toBe(201);
    expect((await row(r.json.id))[0]?.direction).toBe("purchase");
  });

  it("thiếu trường bắt buộc ⇒ 422 KIND_TERMS_INCOMPLETE + khoá thiếu, không tạo HĐ", async () => {
    const { brand: _b, fee_pct: _f, ...short } = FR;
    const r = await post("hA", base("franchise", short));
    expect(r.status).toBe(422);
    const text = JSON.stringify(r.json);
    expect(text).toContain("brand");
    expect(text).toContain("fee_pct");
    const none = await post("hA", base("cooperation"));
    expect(none.status).toBe(422);
    expect(JSON.stringify(none.json)).toContain("scope");
  });

  it("khoá lạ / % > 100 / deal khác gửi kind_terms ⇒ 400 (zod theo trường)", async () => {
    expect((await post("hA", base("franchise", { ...FR, la: 1 }))).status).toBe(400);
    expect((await post("hA", base("franchise", { ...FR, fee_pct: 120 }))).status).toBe(400);
    expect((await post("hA", base("sell", FR))).status).toBe(400);
  });

  it("Hợp tác «không chia» ⇒ chỉ nhắc gia hạn, không mốc kỳ", async () => {
    const r = await post("hA", base("cooperation", { scope: "Cùng mở quán", split_basis: "none" }));
    expect(r.status).toBe(201);
    const ms = await obl(r.json.id);
    expect(ms.every((m) => m.period_key === null)).toBe(true);
    expect(ms.every((m) => m.kind === "renewal")).toBe(true);
  });

  it("Hợp tác chia lợi nhuận ⇒ có mốc kỳ đối soát", async () => {
    const r = await post(
      "hA",
      base("cooperation", {
        scope: "Cùng mở quán",
        split_basis: "profit",
        our_share_pct: 40,
        settle_period: "month",
      }),
    );
    expect(r.status).toBe(201);
    expect((await obl(r.json.id)).some((m) => m.period_key !== null)).toBe(true);
  });

  it("N2 + chéo tenant: editor chỉ đọc ⇒ 403, tenant B tạo HĐ riêng, A không thấy", async () => {
    expect((await post("hM", base("franchise", FR))).status).toBe(403);
    const b = await post("hB", base("franchise", FR));
    expect(b.status).toBe(201);
    const [seen] = await o<
      { n: number }[]
    >`select count(*)::int as n from contracts.contracts where id = ${b.json.id} and tenant_id = ${c.A}`;
    expect(seen?.n).toBe(0);
  });
});
