// HUB-FR-78 · spec H4b2 §3 C (E08 mức route, không DB): param không uuid ⇒ 400 trước service; PUT ⇒ cấp, DELETE ⇒
// thu hồi (cờ truyền đúng). Ca chạm DB ở `tests/acceptance/H4b2/entitlements.int`.
import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { mapError } from "../../../lib/errors";
import { entitlementRoutes } from "./entitlements.routes";
import type { EntitlementsService } from "./entitlements.service";

const A = "a4b20000-0000-4000-8000-000000000001";
const T = "a4b20000-0000-4000-8000-000000000002";

function app(calls: unknown[][]): Hono<AuthVars> {
  const svc = {
    matrix: async () => ({ ok: "matrix" }),
    cell: async (a: string, t: string) => ({ a, t }),
    set: async (_u: unknown, a: string, t: string, on: boolean) => {
      calls.push([a, t, on]);
      return { hub_config_version: 1, affected_grants: 0 };
    },
  } as unknown as EntitlementsService;
  const a = new Hono<AuthVars>();
  a.onError((err, c) => {
    const m = mapError(err);
    return c.json(m.body, m.status);
  });
  a.use("*", async (c, next) => {
    c.set("user", { userId: A, role: "platform_admin" } as never);
    await next();
  });
  a.route("/s", entitlementRoutes(svc));
  return a;
}

describe("entitlementRoutes", () => {
  it("E08 · agent_id / tenant_id không uuid ⇒ 400 VALIDATION_ERROR, không gọi service", async () => {
    const calls: unknown[][] = [];
    for (const [m, p, bad] of [
      ["GET", `/agent-entitlements/abc/${T}`, "agent_id"],
      ["PUT", `/agent-entitlements/${A}/def`, "tenant_id"],
      ["DELETE", "/agent-entitlements/abc/def", "agent_id"],
    ] as const) {
      const r = await app(calls).request(`/s${p}`, { method: m });
      const j = (await r.json()) as {
        error: { code: string; details: { issues: { path: string[] }[] } };
      };
      expect([r.status, j.error.code, j.error.details.issues[0]?.path]).toEqual([
        400,
        "VALIDATION_ERROR",
        [bad],
      ]);
    }
    expect(calls).toEqual([]);
  });

  it("PUT ⇒ set(true), DELETE ⇒ set(false); GET ô/ma trận đi đúng handler", async () => {
    const calls: unknown[][] = [];
    const a = app(calls);
    expect((await a.request(`/s/agent-entitlements/${A}/${T}`, { method: "PUT" })).status).toBe(
      200,
    );
    expect((await a.request(`/s/agent-entitlements/${A}/${T}`, { method: "DELETE" })).status).toBe(
      200,
    );
    expect(calls).toEqual([
      [A, T, true],
      [A, T, false],
    ]);
    expect(await (await a.request(`/s/agent-entitlements/${A}/${T}`)).json()).toEqual({
      a: A,
      t: T,
    });
    expect(await (await a.request("/s/agent-entitlements")).json()).toEqual({ ok: "matrix" });
  });
});
