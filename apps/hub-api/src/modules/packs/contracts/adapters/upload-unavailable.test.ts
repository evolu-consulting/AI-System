// FileBox chưa cấu hình ⇒ POST /contracts trả 503 FILE_STORAGE_UNAVAILABLE (không 404); guard quyền vẫn chạy trước.
import { describe, expect, it } from "bun:test";
import { packFeatureKey } from "@ai/contracts";
import { Hono } from "hono";
import type { AuthUser } from "../../../../lib/auth.middleware";
import { AppError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { uploadUnavailableRoutes } from "./upload.routes";

const view = (writer: boolean): PackAccessView => ({
  catalog: async () => ({
    features: [
      { id: "fr", key: packFeatureKey("contracts", "read"), status: "on" },
      { id: "fw", key: packFeatureKey("contracts", "write"), status: "on" },
    ],
    entitled: new Set(["t1:fr", "t1:fw"]),
    grantGroups: new Map([
      ["t1:fr", ["g1"]],
      ["t1:fw", writer ? ["g1"] : ["gx"]],
    ]),
  }),
  user: async () => ({ tenantId: "t1", groupIds: new Set(["g1"]) }),
});

function app(writer: boolean) {
  const a = new Hono<PackGuardVars>();
  a.use("*", async (c, next) => {
    c.set("user", { userId: "u1", tenantId: "t1" } as AuthUser);
    await next();
  });
  a.route("/pack/contracts", uploadUnavailableRoutes(view(writer)));
  a.onError((e, c) =>
    e instanceof AppError ? c.json({ code: e.code }, e.status as 503) : c.json({}, 500),
  );
  return a;
}

describe("FileBox vắng ⇒ tải lên", () => {
  it("có quyền ghi ⇒ 503 FILE_STORAGE_UNAVAILABLE", async () => {
    const r = await app(true).request("/pack/contracts/contracts", { method: "POST" });
    expect(r.status).toBe(503);
    expect(await r.json()).toEqual({ code: "FILE_STORAGE_UNAVAILABLE" });
  });
  it("không có quyền ghi ⇒ 403 (guard trước)", async () => {
    const r = await app(false).request("/pack/contracts/contracts", { method: "POST" });
    expect(r.status).toBe(403);
  });
});
