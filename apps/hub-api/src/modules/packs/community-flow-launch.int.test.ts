// CR-122 · P13 · e2e `flows.cs.ts › 3`: bước duyệt bài của flow `post.created` mở rất chậm (chờ tới ~120-200 s, trước đó API trả
// FLOW_TASK_NOT_OPEN). Cờ FLOW_TRIGGERS bật ⇒ bài vào "Chờ duyệt" nhưng giữ `mod_screen = running` (agent screen cũ không chạy, flow thay)
// ⇒ `awaitingReview` chỉ true sau SCREEN_STALE_MS (2 phút). Sửa: bộ điều phối mở lượt ⇒ `launched` đưa bài sang "chờ người duyệt".
// Đường thật: route đăng bài → sự kiện → MỘT dispatchOnce (flowLaunchOf thật) → hàng đợi duyệt + decide. Không ngủ chờ.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { withHubScope } from "@ai/db/hub-scope";
import { groups, members } from "@ai/test-kit/builders";
import { cloneDb, openOwner, type Sql } from "@ai/test-kit/db";
import { urls } from "@ai/test-kit/env";
import { Hono } from "hono";
import { type Cast, seedCast } from "../../../../../tests/acceptance/com-c3/_support/cast";
import { connectDb, type Db } from "../../lib/db";
import { mapError } from "../../lib/errors";
import {
  registerFactsReader,
  registerOutcomeHandler,
  unregisterFlowPorts,
} from "../processes/adapters/runs/flow-ports";
import type { ProcessDeps } from "../processes/core/ports";
import { createStageLauncher } from "../processes/runs/launcher";
import { dispatchOnce } from "../processes/triggers/dispatcher";
import { setFlowTriggers } from "../processes/triggers/flags";
import { flowLaunchOf } from "../processes/triggers/flow-launch";
import { communityModule } from "./community/community.mount";
import { pgExternalOrgResolver } from "./kit/adapters/ext-org.pg";
import type { PackAccessView, PackGuardVars } from "./kit/adapters/pack-guard.middleware";

let sql: Sql;
let db: Db;
let c: Cast;
let app: Hono<PackGuardVars>;
const F = { read: "c-r", write: "c-w", admin: "c-a" };
const bg: Promise<unknown>[] = [];

const stage = {
  key: "duyet",
  name: "Duyệt bài",
  step: 0,
  instruction: "",
  output: { filename: "d.md", template: "x", required_sections: ["x"], fields: [] },
  real_action: false,
  answerer: { kind: "starter" },
  token_budget: null,
  executor: { kind: "approve", reject_step: null, return_step: null },
  after: {
    kind: "review",
    group_id: null,
    group_key: "pb-duyet-bai",
    back_to_steps: [],
    remind_every_h: null,
    escalate: null,
    branch: [],
    exclude_starter: false,
  },
};

const view = (): PackAccessView => ({
  catalog: async () => ({
    features: [
      { id: F.read, key: "community-read", status: "on" },
      { id: F.write, key: "community-write", status: "on" },
      { id: F.admin, key: "community-admin", status: "on" },
    ],
    entitled: new Set(Object.values(F).map((f) => `${c.A}:${f}`)),
    grantGroups: new Map([
      [`${c.A}:${F.read}`, [c.roles.owner, c.roles.editor]],
      [`${c.A}:${F.write}`, [c.roles.owner, c.roles.editor]],
      [`${c.A}:${F.admin}`, [c.roles.owner]],
    ]),
  }),
  user: async (id) => ({
    tenantId: c.A,
    groupIds: new Set(id === c.hA ? [c.roles.owner] : []),
  }),
});

const pipe: unknown = new Proxy(
  {},
  { get: (_, k) => (k === "exec" ? async () => [] : () => pipe) },
);
function deps(): ProcessDeps {
  const d = {
    db,
    config: {
      user: async () => ({ active: true, groupIds: new Set<string>() }),
      poll: async () => {},
      catalog: async () => ({ features: [], entitled: new Set(), grantGroups: new Map() }),
    },
    redis: { pipeline: () => pipe },
    notifier: new Proxy({}, { get: () => async () => [] }),
    log: { warn: () => {}, info: () => {}, error: () => {} },
    now: () => new Date(),
    runsPerTenant: 100,
    postThread: async () => {},
  } as unknown as ProcessDeps & { launcher: unknown };
  d.launcher = createStageLauncher(d as never);
  return d;
}

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { "x-who": "hA", "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};
async function newPost(tag: string): Promise<string> {
  const r = await call("POST", "/posts", { type: "note", body: `Thông báo ${tag}` });
  expect(r.status).toBe(201);
  await Promise.all(bg.splice(0));
  return r.json.id as string;
}
const itemOf = async (id: string) => {
  const q = await call("GET", "/moderation/queue");
  expect(q.status).toBe(200);
  return (q.json.items as { id: string; awaitingReview: boolean; taskId: string | null }[]).find(
    (x) => x.id === id,
  );
};
const openTasks = async (postId: string) =>
  (
    await sql<{ n: number }[]>`select count(*)::int as n from hub.review_tasks t
      join hub.process_runs r on r.id = t.process_run_id
      where r.pack_record_id = ${postId}::uuid and t.status = 'open'`
  )[0]?.n ?? 0;

beforeAll(async () => {
  await cloneDb("full");
  sql = openOwner(2);
  c = await seedCast(sql, 123);
  db = connectDb(urls().hubApi, 6);
  const g = await groups(sql, c.A, ["pb-duyet-bai"]);
  await members(sql, c.A, g.get("pb-duyet-bai") as string, [c.hA]);
  const st = JSON.stringify([stage]);
  const [r] = await sql<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, stages, trigger, app, published_version, enabled)
    values (null, 'p13-post', 'Duyệt bài', ${st}::text::jsonb, '{"event":"post.created"}'::jsonb, 'community', 1, true)
    returning id::text as id`;
  const lib = r?.id as string;
  await sql`insert into hub.process_def_releases (def_id, rel_version, name, stages)
    values (${lib}, 1, 'Duyệt bài', ${st}::text::jsonb)`;
  await sql`insert into hub.company_flows (tenant_id, flow_id, enabled) values (${c.A}, ${lib}, true)`;
  await withHubScope(db, { kind: "system" }, (tx) => setFlowTriggers(tx, c.A, true));
  const h = new Hono<PackGuardVars>();
  h.use("*", async (ctx, next) => {
    ctx.set("user", {
      userId: c.hA,
      tenantId: c.A,
      role: "tenant_admin",
      userKind: "internal",
    } as never);
    await next();
  });
  h.route(
    "/",
    communityModule(db, view(), pgExternalOrgResolver(db), {
      flows: {
        moderationOn: async () => true,
        triggersOn: async () => true,
        background: (p) => {
          bg.push(p);
        },
        registerPorts: ({ readers, handler }) => {
          for (const x of readers) registerFactsReader(x);
          registerOutcomeHandler(handler);
        },
      },
    }),
  );
  h.onError((e, ctx) => {
    const m = mapError(e);
    return ctx.json(m.body, m.status);
  });
  app = h;
}, 120_000);
afterAll(async () => {
  unregisterFlowPorts("community");
  await db?.close();
  await sql?.end({ timeout: 2 });
});

describe("CR-122 P13 · duyệt bài khi công ty bật flow post.created", () => {
  it("một dispatchOnce ⇒ task Duyệt mở + bài chờ người duyệt ngay + duyệt được", async () => {
    const id = await newPost("a");
    // trước khi bộ điều phối chạy: chưa có run, chưa tới lượt người duyệt
    expect((await itemOf(id))?.awaitingReview).toBe(false);
    const s = await dispatchOnce({
      db,
      launch: flowLaunchOf(deps()),
      now: () => new Date(Date.now() + 1000),
    });
    const [ev] = await sql<{ error: string | null }[]>`select error from hub.flow_events
      where tenant_id = ${c.A} and event = 'post.created' and ref = ${id}`;
    expect({ ...s, error: ev?.error ?? null }).toMatchObject({
      claimed: 1,
      launched: 1,
      failed: 0,
      error: null,
    });
    expect(await openTasks(id)).toBe(1); // phía engine: task Duyệt đã mở
    const it1 = await itemOf(id);
    expect(it1?.awaitingReview).toBe(true); // phía Community: người duyệt thấy ngay (trước sửa: false tới khi quá 2 phút)
    const d = await call("POST", `/moderation/${id}/decide`, { action: "approve" });
    expect(d.status).toBe(200);
    expect(d.json.moderation).toBe("approved");
  });

  it("perf: sự kiện → bài sẵn sàng duyệt ≤ 5 s (đo *Once, không ngủ)", async () => {
    const t0 = performance.now();
    const id = await newPost("b");
    await dispatchOnce({
      db,
      launch: flowLaunchOf(deps()),
      now: () => new Date(Date.now() + 1000),
    });
    const ok = (await itemOf(id))?.awaitingReview === true && (await openTasks(id)) === 1;
    const ms = performance.now() - t0;
    console.log(`P13 perf: đăng bài → task Duyệt mở ${ms.toFixed(0)} ms`);
    expect(ok).toBe(true);
    expect(ms).toBeLessThanOrEqual(5_000);
  });
});
