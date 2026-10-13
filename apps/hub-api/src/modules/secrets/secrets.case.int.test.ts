// HUB-FR-68 · HUB-BR-30 · RV1 #1: tenant_id (create) và id (rotate) viết HOA vẫn giải được qua `useSecret`
// (id/tenant đọc từ DB là chữ thường) — AAD độc lập hoa/thường.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { HUB_API_URL } from "../../../../../tests/acceptance/H1/_fixtures";
import {
  type Ctx,
  create,
  HUB_KEY,
  idOf,
  startH4b1,
  studio,
  T,
  tenantApi,
  val,
} from "../../../../../tests/acceptance/H4b1/_h4b1";
import { connectDb, type Db } from "../../lib/db";
import { HubSecretReader } from "./secrets.use";

let x: Ctx;
let db: Db;
beforeAll(async () => {
  x = await startH4b1();
  db = connectDb(HUB_API_URL, 2);
});
afterAll(async () => {
  await db?.close();
  await x?.stop();
});

describe("HUB-FR-68 · RV1 #1 · UUID HOA ở biên", () => {
  it("create tenant_id HOA → rotate id HOA → useSecret (tenant thường) đọc đúng giá trị mới", async () => {
    const reader = new HubSecretReader({ db, key: HUB_KEY, log: { warn: () => {} } });
    const c = await create(x, {
      kind: "source_credential",
      name: "rv1-upper",
      value: val("rv1-a"),
      tenant_id: T.acme.toUpperCase(),
    });
    expect(c.status).toBe(201);
    const id = idOf(c);
    const ref = { id, kind: "source_credential" as const, tenantId: T.acme };
    expect(await reader.useSecret(ref, async (v) => v)).toBe(val("rv1-a"));
    const r = await studio(x, "padmin", "PUT", `/${id.toUpperCase()}`, {
      version: 1,
      value: val("rv1-b"),
    });
    expect(r.status).toBe(200);
    expect(await reader.useSecret(ref, async (v) => v)).toBe(val("rv1-b"));
  });
});

describe("HUB-FR-68 · RV2 #5 · route /admin/source-credentials, platform_admin, tenant_id HOA", () => {
  it("POST → GET → rotate với tenant_id HOA ⇒ đúng tenant, useSecret đọc được", async () => {
    const reader = new HubSecretReader({ db, key: HUB_KEY, log: { warn: () => {} } });
    const up = T.acme.toUpperCase();
    const c = await tenantApi(x, "padmin", "POST", "", {
      name: "rv2-upper",
      value: val("rv2-a"),
      tenant_id: up,
    });
    expect(c.status).toBe(201);
    const id = idOf(c);
    const ref = { id, kind: "source_credential" as const, tenantId: T.acme };
    expect(await reader.useSecret(ref, async (v) => v)).toBe(val("rv2-a"));
    const g = await tenantApi(x, "padmin", "GET", `/${id}?tenant_id=${up}`);
    expect(g.status).toBe(200);
    expect(g.json?.id).toBe(id);
    const r = await tenantApi(x, "padmin", "PUT", `/${id}?tenant_id=${up}`, {
      version: 1,
      value: val("rv2-b"),
    });
    expect(r.status).toBe(200);
    expect(await reader.useSecret(ref, async (v) => v)).toBe(val("rv2-b"));
  });
});
