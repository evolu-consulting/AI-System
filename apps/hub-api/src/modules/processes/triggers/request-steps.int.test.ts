// CR-125 · cr125-request-steps · int (Hono thật + DB thật, role hub_api): `GET /processes/requests/:run_id` trả cây bước — lượt cha + lượt con
// (Quy trình con, `parent_run_id`) lồng nhau, cùng FlowView với thẻ HĐ. Người bắt đầu thấy cả cha lẫn con; người ngoài ⇒ 404; công ty khác
// ⇒ 404; mở bằng lượt CON ⇒ báo lượt gốc (người xem xem được lượt gốc).
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
import { manualStartRoutes } from "./manual-start.routes";

const X = tenantId(1431);
const Y = tenantId(1432);
const WHO: Record<string, { userId: string; tenantId: string; role: Role }> = {
  A: { userId: userId(1431), tenantId: X, role: "member" }, // người gửi (bắt đầu cả cha lẫn con)
  B: { userId: userId(1432), tenantId: X, role: "member" }, // người ngoài (không bắt đầu, không được giao)
  O: { userId: userId(1433), tenantId: Y, role: "tenant_admin" }, // công ty khác
};
let o: Sql;
let db: Db;
let app: Hono<AuthVars>;
let parent = "";
let child = "";
let grand = "";

const snap = (name: string) => ({
  key: name,
  name,
  stages: [
    {
      key: "b0",
      name: `${name} · bước 1`,
      node: "core.subprocess",
      step: 0,
      executor: { kind: "set", values: [] },
      after: { kind: "auto", branch: [] },
    },
  ],
});

async function seedRun(p: {
  tid: string;
  starter: string;
  def: string;
  conv: string;
  name: string;
}): Promise<string> {
  const { tid, starter, def, conv, name } = p;
  const [r] = await o<
    { id: string }[]
  >`insert into hub.process_runs (tenant_id, process_def_id, def_version, snapshot, started_by, origin_kind, input,
      conversation_id, flow_id, current_step, current_stage_idx, status)
    values (${tid}, ${def}, 1, ${o.json(snap(name) as never)}, ${starter}, 'admin', 'x', ${conv},
      gen_random_uuid(), 0, 0, 'running') returning id::text as id`;
  const id = r?.id as string;
  await o`insert into hub.stage_runs (tenant_id, process_run_id, stage_idx, status) values (${tid}, ${id}, 0, 'queued')`;
  return id;
}

beforeAll(async () => {
  await cloneDb("full");
  o = openOwner(2);
  db = connectDb(urls().hubApi, 4);
  await o`insert into admin.tenants (id, key, name) values (${X}, 't1431', 'X'), (${Y}, 't1432', 'Y')`;
  await users(o, X, 2, { from: 1431 });
  await users(o, Y, 1, { from: 1433 });
  const [d] = await o<{ id: string }[]>`insert into hub.process_defs (tenant_id, key, name, stages)
    values (${X}, 'rs', 'rs', ${o.json([{ key: "b0" }])}) returning id::text as id`;
  const [c] = await o<
    { id: string }[]
  >`insert into hub.conversations (tenant_id, user_id, title, title_norm)
    values (${X}, ${WHO.A?.userId as string}, 'c', 'c') returning id::text as id`;
  const a = WHO.A?.userId as string;
  const base = { tid: X, starter: a, def: d?.id as string, conv: c?.id as string };
  parent = await seedRun({ ...base, name: "Cha" });
  child = await seedRun({ ...base, name: "Phần 1" });
  grand = await seedRun({ ...base, name: "Phần 1.1" });
  const link = (c: string, p: string) => o`update hub.process_runs set parent_run_id = ${p},
      parent_stage_run_id = s.id, parent_attempt = s.attempt, parent_round = s.round
    from hub.stage_runs s where s.process_run_id = ${p} and s.stage_idx = 0 and hub.process_runs.id = ${c}`;
  await link(child, parent);
  await link(grand, child);
  const deps = {
    db,
    config: {
      user: async () => ({ active: true, groupIds: new Set<string>() }),
      poll: async () => {},
    },
    launcher: { kick: async () => {} },
    log: { warn: () => {}, info: () => {}, error: () => {} },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  } as unknown as ProcessDeps;
  app = new Hono<AuthVars>();
  app.use("*", async (c, next) => {
    c.set("user", WHO[c.req.header("x-who") ?? ""] as never);
    await next();
  });
  app.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  app.route("/", manualStartRoutes(deps));
}, 180_000);
afterAll(async () => {
  await db?.close();
  await o?.end({ timeout: 2 });
});

const get = async (who: string, id: string) => {
  const r = await app.request(`/processes/requests/${id}`, { headers: { "x-who": who } });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : {} };
};

describe("CR-125 · cây bước của yêu cầu (cha + lượt con)", () => {
  it("người gửi thấy bước của lượt cha và các lượt con lồng nhau (theo parent_run_id)", async () => {
    const r = await get("A", parent);
    expect(r.status).toBe(200);
    const s = r.json.steps;
    expect(s.run_id).toBe(parent);
    expect(s.flow.steps.map((x: { name: string }) => x.name)).toEqual(["Cha · bước 1"]);
    expect(s.flow.slot).toBe("processes.request");
    expect(s.children.map((c: { run_id: string }) => c.run_id)).toEqual([child]);
    expect(s.children[0]).toMatchObject({ name: "Phần 1", parent_stage_idx: 0 });
    expect(s.children[0].flow.steps[0].name).toBe("Phần 1 · bước 1");
    expect(s.children[0].children.map((c: { run_id: string }) => c.run_id)).toEqual([grand]);
    expect(r.json.root_run_id).toBeNull();
  });

  it("mở bằng lượt CON ⇒ người xem xem được lượt gốc nên được báo root_run_id", async () => {
    const r = await get("A", child);
    expect(r.status).toBe(200);
    expect(r.json.steps.run_id).toBe(child);
    expect(r.json.root_run_id).toBe(parent);
  });

  it("người ngoài (không gửi, không được giao) ⇒ 404 cả lượt cha lẫn con", async () => {
    expect((await get("B", parent)).status).toBe(404);
    expect((await get("B", child)).status).toBe(404);
  });

  it("công ty khác ⇒ 404", async () => {
    expect((await get("O", parent)).status).toBe(404);
    expect((await get("O", grand)).status).toBe(404);
  });
});
