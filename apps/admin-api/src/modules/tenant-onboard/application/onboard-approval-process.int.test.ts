// CR-105 L5 · int: yaml `approval_process` => slot assignment, through the real HTTP adapter against the real hub library
// routes (in-process Hono app, hub_api role) on a real DB. State checks: hub.process_slot_assignments row, tenant row.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Role } from "@ai/contracts";
import { Hono } from "hono";
import { HUB_API_URL, T } from "../../../../../../tests/acceptance/H1/_fixtures";
import { type CtxI1, startI1 } from "../../../../../../tests/acceptance/I1/_support/i1";
import type { AuthVars } from "../../../../../hub-api/src/lib/auth.middleware";
import { connectDb, type Db } from "../../../../../hub-api/src/lib/db";
import { mapError } from "../../../../../hub-api/src/lib/errors";
import { approvalEngineTools } from "../../../../../hub-api/src/modules/packs/contracts/adapters/approval-engine.tools";
import { approvalSlotSpec } from "../../../../../hub-api/src/modules/packs/contracts/approval.mount";
import { APPROVAL_DEFAULT_DEF } from "../../../../../hub-api/src/modules/packs/contracts/domain/approval-slot-default.rules";
import { slotRegistry } from "../../../../../hub-api/src/modules/packs/kit/adapters/slot-registry";
import type { PackToolCatalog } from "../../../../../hub-api/src/modules/packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../../../../../hub-api/src/modules/processes/core/ports";
import { defsRoutes } from "../../../../../hub-api/src/modules/processes/defs/defs.routes";
import { libraryInternalRoutes } from "../../../../../hub-api/src/modules/processes/library/library.internal.routes";
import { libraryRoutes } from "../../../../../hub-api/src/modules/processes/library/library.routes";
import { parseSpec } from "../adapters/onboard.schema";
import { onboardTenant } from "../tenant-onboard.run";

const SLOT = "contracts.approval";
const TOKEN = "int-test-internal-token";
let ctx: CtxI1;
let hubDb: Db;
let app: Hono<AuthVars>;

function approvalCatalog(): PackToolCatalog {
  slotRegistry.register(approvalSlotSpec);
  const tools = approvalEngineTools({ uow: null, bridge: {} } as never).map((t) => ({
    key: t.name,
    name: t.name,
    description: t.description,
    sideEffect: false,
    action: t.action,
    params: t.params,
  }));
  return {
    has: (k: string) => tools.some((t) => t.key === k),
    info: (k: string) => tools.find((t) => t.key === k),
    enabled: async () => true,
    available: async (_t: string, keys?: readonly string[]) =>
      tools.filter((t) => !keys || keys.includes(t.key)),
  } as unknown as PackToolCatalog;
}

// biome-ignore lint/suspicious/noExplicitAny: JSON in test
const hubCall = async (method: string, path: string, body?: unknown): Promise<any> => {
  const r = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : {} };
};

/** Clone the seeded default def and publish it as library process `key` (default body = contracts-* role groups). */
async function publishedLibraryDef(key: string): Promise<string> {
  const c = await hubCall("POST", `/process-defs/${APPROVAL_DEFAULT_DEF.id}/clone`, {
    key,
    name: `QT ${key}`,
  });
  expect(c.status).toBe(201);
  const cur = await hubCall("GET", `/process-defs/${c.json.id}`);
  const p = await hubCall("POST", `/process-defs/${c.json.id}/publish`, {
    version: cur.json.version,
  });
  expect(p.status).toBe(201);
  return c.json.id as string;
}

const specOf = (key: string, approval: string) => {
  const r = parseSpec(
    [
      `key: ${key}`,
      `name: Onboard ${key}`,
      "packs: [contracts]",
      "root: { key: pb-root, vi: Goc }",
      `approval_process: ${approval}`,
    ].join("\n"),
  );
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.spec;
};

const hubCfg = () => ({
  url: "http://hub.test",
  internalToken: TOKEN,
  fetch: (url: string, init: RequestInit) => {
    const u = new URL(url);
    return Promise.resolve(app.request(u.pathname + u.search, init));
  },
});

/** The contracts pack needs the shared `assistant` agent to grant; the template DB may lack it. */
async function ensureAssistant(): Promise<void> {
  const [a] = await ctx.sql`select 1 from hub.agents where key = 'assistant'`;
  if (a) return;
  await ctx.sql`insert into hub.providers (key, kind, vendor, max_concurrency, enabled, dev_only)
    values ('niti-fake', 'subscription', 'fake', 1, true, true) on conflict do nothing`;
  const [p] = await ctx.sql<{ id: string }[]>`insert into hub.model_profiles (key, steps)
    values ('niti-fake-1', ${ctx.sql.json([{ provider_key: "niti-fake", model: null, on: [] }])}) returning id`;
  await ctx.sql`insert into hub.agents (key, name, description, runtime, profile_id)
    values ('assistant', ${ctx.sql.json({ vi: "Trợ lý", en: "Assistant" })},
      'Trợ lý quản lý hợp đồng của gói contracts cho người dùng.', 'agentic-cli', ${p?.id as string})`;
}

beforeAll(async () => {
  ctx = await startI1();
  await ensureAssistant();
  hubDb = connectDb(HUB_API_URL, 4);
  const who = { userId: ctx.padmin, tenantId: T.acme, role: "platform_admin" as Role };
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", who as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  const deps = { db: hubDb, packTools: approvalCatalog(), start: {} } as unknown as ProcessDeps;
  app.route("/", defsRoutes(deps));
  app.route("/", libraryRoutes(deps));
  app.route("/internal", libraryInternalRoutes(deps, TOKEN));
}, 180_000);

afterAll(async () => {
  await hubDb?.close();
  await ctx?.stop();
});

describe("onboard approval_process", () => {
  test("approval_process trong yaml ⇒ gán khe", async () => {
    const defId = await publishedLibraryDef("pl-onb-ok");
    const r = await onboardTenant(ctx.db, specOf("plonb1", "pl-onb-ok"), ctx.padmin, hubCfg());
    expect(r.approval).toEqual({ process: "pl-onb-ok", slot: SLOT, state: "assigned" });
    const rows = await ctx.sql`select def_id from hub.process_slot_assignments
      where tenant_id = ${r.tenant.id} and slot = ${SLOT}`;
    expect(rows.map((x) => x.def_id)).toEqual([defId]);
    const [au] = await ctx.sql`select actor_id from hub.audit_log
      where action = 'assign' and entity_id = ${defId} order by at desc limit 1`;
    expect(au?.actor_id).toBe(ctx.padmin); // audit carries the onboarding actor
  });

  test("ký hiệu sai ⇒ lỗi bước, tenant vẫn tạo", async () => {
    const r = await onboardTenant(ctx.db, specOf("plonb2", "khong-co"), ctx.padmin, hubCfg());
    expect(r.tenant.created).toBe(true);
    expect(r.approval).toEqual({
      process: "khong-co",
      slot: SLOT,
      state: "error",
      error: "NOT_FOUND",
    });
    const [t] = await ctx.sql`select 1 from admin.tenants where key = 'plonb2'`;
    expect(t).toBeDefined();
    const n =
      await ctx.sql`select 1 from hub.process_slot_assignments where tenant_id = ${r.tenant.id}`;
    expect(n).toHaveLength(0);
  });
});
