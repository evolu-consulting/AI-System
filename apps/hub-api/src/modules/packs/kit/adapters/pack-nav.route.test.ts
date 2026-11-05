// CR-121 C-7 · `GET /pack/nav`: công ty CHỈ bật Sổ Hợp Tác vẫn thấy cap + số (không phụ thuộc Community); gói tắt không bị gọi;
// nguồn lỗi chỉ ẩn mục của gói đó; nguồn nhận đúng tenant của người gọi.
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { createPackNavRegistry } from "../application/pack-nav.ports";
import type { PackAccessView, PackGuardVars } from "./pack-guard.middleware";
import { packNavRoutes } from "./pack-nav.route";

const TENANT = "t-only-contracts";
const view: PackAccessView = {
  catalog: async () => ({
    features: [{ id: "f1", key: "contracts-read", status: "on" }],
    entitled: new Set([`${TENANT}:f1`]),
    grantGroups: new Map(),
  }),
  user: async () => ({ tenantId: TENANT, groupIds: new Set() }),
};

function app(registry: ReturnType<typeof createPackNavRegistry>) {
  const h = new Hono<PackGuardVars>();
  h.use("*", async (c, next) => {
    c.set("user", {
      userId: "u1",
      tenantId: TENANT,
      role: "member",
      userKind: "internal",
    } as never);
    await next();
  });
  h.route("/pack", packNavRoutes(view, registry));
  return h;
}

describe("GET /pack/nav", () => {
  it("công ty chỉ bật Sổ Hợp Tác ⇒ thấy contracts.review + số; Community tắt ⇒ không gọi nguồn Community", async () => {
    const seen: string[] = [];
    const r = createPackNavRegistry();
    r.register({
      pack: "contracts",
      caps: async (u) => {
        seen.push(`contracts:${u.tenantId}`);
        return [{ cap: "contracts.review", count: 4 }];
      },
    });
    r.register({
      pack: "community",
      caps: async (u) => {
        seen.push(`community:${u.tenantId}`);
        return [{ cap: "community.join", count: 9 }];
      },
    });
    const res = await app(r).request("/pack/nav");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [{ cap: "contracts.review", count: 4 }] });
    expect(seen).toEqual([`contracts:${TENANT}`]); // đúng tenant của người gọi; gói tắt không bị gọi
  });

  it("một nguồn lỗi ⇒ chỉ mục của gói đó ẩn, route vẫn 200", async () => {
    const r = createPackNavRegistry();
    r.register({
      pack: "contracts",
      caps: async () => {
        throw new Error("boom");
      },
    });
    const res = await app(r).request("/pack/nav");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: [] });
  });
});
