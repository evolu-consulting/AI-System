// CR-127 · E8 · BR-10/11 · int (Hono thật `defsRoutes` + `libraryRoutes`): quản trị công ty chỉ XEM — `/process-defs` ghi/xoá/chạy thử
// và luật định tuyến ghi ⇒ 403 `FORBIDDEN_TENANT_ADMIN_WRITE` (trước parse/DB); GET 200; quản trị nền tảng KHÔNG bị chặn (qua cổng vai).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "../defs/defs.routes";
import { libraryRoutes } from "./library.routes";

const X = tenantId(1281);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  P: { userId: userId(1280), tenantId: X, role: "platform_admin" },
  A: { userId: userId(1281), tenantId: X, role: "tenant_admin" },
};
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
const ID = "00000000-0000-4000-8000-000000000001";

async function call(who: string, method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  // biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> };
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1281', 'X')`;
  await users(o, X, 2, { from: 1280 });
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    if (m.status === 500) console.error(e);
    return c.json(m.body, m.status);
  });
  const d = { db } as unknown as ProcessDeps;
  app.route("/", defsRoutes(d));
  app.route("/", libraryRoutes(d));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-127 E8 · quản trị công ty chỉ xem (defs + luật định tuyến)", () => {
  it("tenant_admin: GET 200; ghi/xoá/luật định tuyến ⇒ 403 FORBIDDEN_TENANT_ADMIN_WRITE", async () => {
    expect((await call("A", "GET", "/process-defs")).status).toBe(200);
    const slot = "community.post-moderation";
    const R = `/tenants/${X}/process-routing/${slot}`;
    expect((await call("A", "GET", R)).status).not.toBe(403); // slot chưa đăng ký trong test ⇒ 422, quan trọng: không bị chặn vai
    const cases: [string, string, unknown][] = [
      ["POST", "/process-defs", {}],
      ["PUT", `/process-defs/${ID}`, {}],
      ["DELETE", `/process-defs/${ID}?version=1`, undefined],
      ["PUT", R, { version: 1, rules: [] }],
    ];
    for (const [m, p, b] of cases) {
      const r = await call("A", m, p, b);
      expect([m, p, r.status, r.json.error?.code]).toEqual([
        m,
        p,
        403,
        "FORBIDDEN_TENANT_ADMIN_WRITE",
      ]);
    }
  });

  it("platform_admin không bị cổng quản trị công ty chặn (body hỏng ⇒ 400/404, không phải 403 ghi)", async () => {
    expect((await call("P", "GET", "/process-defs")).status).toBe(200);
    const p = await call("P", "PUT", `/process-defs/${ID}`, {});
    expect([p.status === 403, p.json.error?.code === "FORBIDDEN_TENANT_ADMIN_WRITE"]).toEqual([
      false,
      false,
    ]);
    const c = await call("P", "POST", "/process-defs", {});
    expect(c.status).toBe(400);
  });
});
