// CR-105 · L5 · `PUT /internal/tenants/:tid/process-slots/:slot {process_key, actor}` (token dịch vụ HUB_INTERNAL_TOKEN, không JWT) trên DB
// thật (`hub_api`): thiếu/sai token ⇒ 401 không ghi; token đúng ⇒ gán def thư viện theo key + audit mang actor; key lạ ⇒ 404.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { groups, tenantId, userId, users } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { connectDb, type Db } from "../../../lib/db";
import { mapError } from "../../../lib/errors";
import { approvalEngineTools } from "../../packs/contracts/adapters/approval-engine.tools";
import { approvalSlotSpec } from "../../packs/contracts/approval.mount";
import { APPROVAL_DEFAULT_DEF } from "../../packs/contracts/domain/approval-slot-default.rules";
import { slotRegistry } from "../../packs/kit/adapters/slot-registry";
import type { PackToolCatalog } from "../../packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../core/ports";
import { libraryInternalRoutes } from "./library.internal.routes";

const SLOT = "contracts.approval";
const TOKEN = "lib-internal-int-token";
const X = tenantId(1081);
const ACTOR = userId(1080);
const URL_OF = (t: string) => `/internal/tenants/${t}/process-slots/${SLOT}`;

let o: Sql;
let db: Db;
let app: Hono;

const put = (auth: string | null, body: unknown, tid = X) =>
  app.request(URL_OF(tid), {
    method: "PUT",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
const assigned = async () =>
  o`select def_id from hub.process_slot_assignments where tenant_id = ${X} and slot = ${SLOT}`;

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1081', 'Công ty X')`;
  await users(o, X, 1, { from: 1080 });
  await groups(o, X, ["contracts-editor", "contracts-owner"]);
  slotRegistry.register(approvalSlotSpec);
  const tools = approvalEngineTools({ uow: null, bridge: {} } as never).map((t) => ({
    key: t.name,
    name: t.name,
    description: t.description,
    sideEffect: false,
    action: t.action,
    params: t.params,
  }));
  const packTools = {
    has: (k: string) => tools.some((t) => t.key === k),
    info: (k: string) => tools.find((t) => t.key === k),
    enabled: async () => true,
    available: async (_t: string, keys?: readonly string[]) =>
      tools.filter((t) => !keys || keys.includes(t.key)),
  } as unknown as PackToolCatalog;
  const deps = { db, packTools, start: {} } as unknown as ProcessDeps;
  app = new Hono();
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  app.route("/internal", libraryInternalRoutes(deps, TOKEN));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

describe("CR-105 · L5 · gán quy trình nội bộ", () => {
  it("thiếu / sai token ⇒ 401, không ghi; chưa cấu hình token ⇒ 503", async () => {
    const body = { process_key: APPROVAL_DEFAULT_DEF.key, actor: ACTOR };
    expect((await put(null, body)).status).toBe(401);
    expect((await put("Bearer wrong", body)).status).toBe(401);
    expect(await assigned()).toHaveLength(0);
    const off = new Hono();
    off.route(
      "/internal",
      libraryInternalRoutes({ db, start: {} } as unknown as ProcessDeps, undefined),
    );
    const r = await off.request(URL_OF(X), {
      method: "PUT",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(r.status).toBe(503);
  });

  it("token đúng ⇒ gán theo key + audit có actor; key lạ ⇒ 404", async () => {
    const r = await put(`Bearer ${TOKEN}`, { process_key: APPROVAL_DEFAULT_DEF.key, actor: ACTOR });
    expect(r.status).toBe(200);
    expect((await assigned()).map((x) => x.def_id)).toEqual([APPROVAL_DEFAULT_DEF.id]);
    const [a] = await o`select actor_id from hub.audit_log
      where action = 'assign' and entity_id = ${APPROVAL_DEFAULT_DEF.id} order by at desc limit 1`;
    expect(a?.actor_id).toBe(ACTOR);
    const nf = await put(`Bearer ${TOKEN}`, { process_key: "khong-co", actor: ACTOR });
    expect(nf.status).toBe(404);
  });
});
