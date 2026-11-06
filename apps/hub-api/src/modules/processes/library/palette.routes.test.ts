// CR-122 · N1 · FLOW2-FR-25 · `GET /process-palette` (Hono thật, cache cấu hình giả — không DB): node lõi + node của tính năng đang
// bật cho công ty; platform_admin không chọn công ty ⇒ mọi node; member 403. `nodeFeatureMiss` báo đúng node của tính năng tắt.
import { describe, expect, test } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { nodeFeatureMiss } from "../defs/node-features";
import { paletteRoutes } from "./palette.routes";

const X = "00000000-0000-4000-8000-000000001281";
const view = {
  catalog: async () => ({
    features: [
      { id: "f1", key: "contracts-write", status: "on" },
      { id: "f2", key: "community-write", status: "on" },
    ],
    entitled: new Set([`${X}:f1`]),
    grantGroups: new Map(),
  }),
  user: async () => undefined,
};
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  A: { userId: "00000000-0000-4000-8000-000000001282", tenantId: X, role: "tenant_admin" },
  P: { userId: "00000000-0000-4000-8000-000000001283", tenantId: X, role: "platform_admin" },
  M: { userId: "00000000-0000-4000-8000-000000001284", tenantId: X, role: "member" },
};
const app = new Hono<AuthVars>();
app.use("*", async (c, next) => {
  c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
  await next();
});
app.onError((e, c) => {
  const m = mapError(e);
  return c.json(m.body, m.status);
});
app.route("/", paletteRoutes({ config: view } as unknown as ProcessDeps));
const keys = async (who: string, q = "") => {
  const r = await app.request(`/process-palette${q}`, { headers: { "x-who": who } });
  return {
    status: r.status,
    keys:
      r.status === 200
        ? ((await r.json()) as { items: { key: string }[] }).items.map((n) => n.key)
        : [],
  };
};

describe("CR-122 N1 · bảng node", () => {
  test("tenant_admin: lõi + Ký số (contracts-write bật), không Hiện bài (community-write chưa cấp)", async () => {
    const r = await keys("A");
    expect(r.status).toBe(200);
    expect(r.keys).toEqual([
      "core.email",
      "core.bell",
      "core.wait-until",
      "core.wait-for",
      "contracts.esign",
    ]);
    expect((await keys("A", "?app=community")).keys).not.toContain("community.show-post");
  });
  test("platform_admin không chọn công ty ⇒ mọi node; member 403", async () => {
    expect((await keys("P")).keys).toContain("community.show-post");
    expect((await keys("M")).status).toBe(403);
  });
  test("nodeFeatureMiss: node của tính năng tắt ⇒ nêu node + tính năng; node lõi/bật ⇒ null", async () => {
    expect(await nodeFeatureMiss(view, X, ["core.email", "contracts.esign", undefined])).toBeNull();
    expect(await nodeFeatureMiss(view, X, ["community.show-post"])).toEqual({
      node: "community.show-post",
      label: "Hiện bài",
      feature: "community-write",
    });
  });
});
