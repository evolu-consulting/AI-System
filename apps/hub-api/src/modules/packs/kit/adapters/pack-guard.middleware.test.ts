// PK-FR-05 · PK-NFR-01 · D-11 · N1 plan §5 · `packGuard` + `packAccessInput` trên cổng giả (không DB): mã lỗi, gói chưa cài,
// feature của việc bị off, tenant lệch, chỉ mục dựng một lần mỗi ảnh catalog.
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { mapError } from "../../../../lib/errors";
import {
  type PackAccessView,
  type PackCatalogView,
  type PackGuardVars,
  packAccessInput,
  packGuard,
} from "./pack-guard.middleware";

const T = "t1";
const F = { read: "f-r", write: "f-w", admin: "f-a" };
const cat = (o: Partial<PackCatalogView> = {}): PackCatalogView => ({
  features: [
    { id: F.read, key: "pk-read", status: "on" },
    { id: F.write, key: "pk-write", status: "beta" },
    { id: F.admin, key: "pk-admin", status: "on" },
  ],
  entitled: new Set(Object.values(F).map((f) => `${T}:${f}`)),
  grantGroups: new Map([
    [`${T}:${F.read}`, ["g-view", "g-edit"]],
    [`${T}:${F.write}`, ["g-edit"]],
    [`${T}:${F.admin}`, ["g-own"]],
  ]),
  ...o,
});
const view = (c: PackCatalogView, groups: string[], tenantId = T): PackAccessView => ({
  catalog: async () => c,
  user: async () => ({ tenantId, groupIds: new Set(groups) }),
});
const who = { userId: "u1", tenantId: T };

async function hit(v: PackAccessView, action: "read" | "write" | "admin") {
  const app = new Hono<PackGuardVars>();
  app.use("*", async (c, next) => {
    c.set("user", { ...who, role: "member" });
    await next();
  });
  app.get("/x", packGuard(v, "pk", action), (c) => c.text("ok"));
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  const r = await app.request("/x");
  const body = r.status === 200 ? null : ((await r.json()) as { error: { code: string } });
  return { status: r.status, code: body ? body.error.code : "ok" };
}

describe("packGuard", () => {
  test("PK-AC05 · editor: read/write qua, admin ⇒ 403 PACK_FORBIDDEN; beta coi như on", async () => {
    const v = view(cat(), ["g-edit"]);
    expect(await hit(v, "read")).toEqual({ status: 200, code: "ok" });
    expect(await hit(v, "write")).toEqual({ status: 200, code: "ok" });
    expect(await hit(v, "admin")).toEqual({ status: 403, code: "PACK_FORBIDDEN" });
  });
  test("PK-AC06 · thiếu entitlement read / read off / gói chưa cài ⇒ 403 PACK_DISABLED", async () => {
    const noEnt = cat({ entitled: new Set([`${T}:${F.write}`]) });
    const off = cat({
      features: cat().features.map((f) => (f.id === F.read ? { ...f, status: "off" } : f)),
    });
    for (const c of [noEnt, off, cat({ features: [] })])
      expect(await hit(view(c, ["g-own"]), "read")).toEqual({
        status: 403,
        code: "PACK_DISABLED",
      });
  });
  test("PK-FR-05 · feature của việc bị off hoặc mất entitlement ⇒ việc đó không có (fail-closed)", async () => {
    const off = cat({
      features: cat().features.map((f) => (f.id === F.write ? { ...f, status: "off" } : f)),
    });
    const i = await packAccessInput(view(off, ["g-edit"]), "pk", who);
    expect(i.grantedByAction.write).toEqual([]);
    expect(i.grantedByAction.read).toEqual(["g-view", "g-edit"]);
  });
  test("PK-FR-05 · user cache thuộc tenant khác token ⇒ không Group nào (FORBIDDEN)", async () => {
    expect(await hit(view(cat(), ["g-own"], "t2"), "read")).toEqual({
      status: 403,
      code: "PACK_FORBIDDEN",
    });
  });
});
