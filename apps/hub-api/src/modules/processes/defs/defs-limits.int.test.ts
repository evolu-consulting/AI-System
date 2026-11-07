// CR-122 · p22 · int (Hono thật `defsRoutes` + DB thật, migration hub 0115): số bước tối đa là cài đặt nền tảng —
// mặc định 22; platform_admin đổi (≤ trần 50), tenant_admin chỉ đọc; lưu def vượt ⇒ 422 `PROCESS_DEF_INVALID` + `stages_max`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts/common";
import { tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthVars } from "../../../lib/auth.middleware";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import type { ProcessDeps } from "../core/ports";
import { defsRoutes } from "./defs.routes";

const X = tenantId(1232);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  A: { userId: userId(1232), tenantId: X, role: "tenant_admin" },
  P: { userId: userId(1232), tenantId: X, role: "platform_admin" },
};
// biome-ignore lint/suspicious/noExplicitAny: JSON response trong test
type Json = Record<string, any>;

let o: Sql;
let db: Db;
let app: Hono<AuthVars>;

async function call(who: "A" | "P", method: string, path: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json", "x-who": who },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Json };
}

const stage = (key: string, step: number) => ({
  key,
  name: key.toUpperCase(),
  step,
  executor: { kind: "set", values: [{ key: "x", from: { const: "1" } }] },
  instruction: "",
  output: {
    filename: `${key}.md`,
    template: "# x",
    required_sections: ["x"],
    fields: [{ key: "x", type: "string", required: false }],
  },
  after: { kind: "auto", branch: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
});
const body = (key: string, n: number) => ({
  key,
  name: "Giới hạn bước",
  description: "",
  input_hint: "",
  run_group_ids: [],
  stages: Array.from({ length: n }, (_, i) => stage(`s${i}`, i)),
  token_budget: null,
  enabled: true,
  sources: [],
  inputs: [],
});

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1232', 'X')`;
  await users(o, X, 1, { from: 1232 });
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
  app.route("/", defsRoutes({ db, packTools: undefined, start: {} } as unknown as ProcessDeps));
}, 180_000);

afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-122 p22 · số bước tối đa là cài đặt nền tảng", () => {
  it("mặc định 22; platform_admin đổi, tenant_admin đọc được nhưng không đổi được; quá trần 50 bị từ chối", async () => {
    const g = await call("A", "GET", "/process-editor/limits");
    expect(g.json).toEqual({ stages_max: 22, ceiling: 50, default: 22 });
    expect((await call("A", "PUT", "/process-editor/limits", { stages_max: 5 })).status).toBe(403);
    expect((await call("P", "PUT", "/process-editor/limits", { stages_max: 51 })).status).toBe(400);
    const s = await call("P", "PUT", "/process-editor/limits", { stages_max: 3 });
    expect(s.status).toBe(200);
    expect((await call("A", "GET", "/process-editor/limits")).json.stages_max).toBe(3);
  });

  it("đường hub_rw không ghi thẳng được bảng cài đặt nền tảng (chỉ hàm SECURITY DEFINER, khoá + giá trị được kiểm)", async () => {
    const direct = await db
      .execute(
        sql`insert into hub.platform_settings (key, value) values ('process.stages_max', '999'::jsonb)`,
      )
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(direct).not.toBeNull();
    const bad = await db
      .execute(sql`select hub.set_platform_setting('process.stages_max', '999'::jsonb, null)`)
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(bad).not.toBeNull();
  });

  it("lưu quy trình vượt cài đặt ⇒ 422 kèm trần, nâng lên 30 thì lưu được 25 bước (DB nới CHECK)", async () => {
    const ok = await call("A", "POST", "/process-defs", body("p22-ok", 3));
    expect(ok.status).toBe(201);
    const bad = await call("A", "POST", "/process-defs", body("p22-bad", 4));
    expect(bad.status).toBe(422);
    expect(bad.json.error?.code ?? bad.json.code).toBe("PROCESS_DEF_INVALID");
    const det = bad.json.error?.details ?? bad.json.details;
    expect(det).toMatchObject({ paths: ["stages"], stages_max: 3 });
    await call("P", "PUT", "/process-editor/limits", { stages_max: 30 });
    const big = await call("A", "POST", "/process-defs", body("p22-big", 25));
    expect(big.status).toBe(201);
    expect(big.json.stages).toHaveLength(25);
  });
});
