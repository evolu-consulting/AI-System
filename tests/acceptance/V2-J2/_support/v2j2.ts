// V2-J2 · hạ tầng int: hub-api THẬT + admin-api THẬT (như HD1) nhưng AI client chung dùng nhà cung cấp GIẢ tất định (seam
// `packs.contractsAi.model`) — không gọi AI thật; ghi lại mọi lời gọi để kiểm "chỉ gửi tên SP". Không chứa `it(...)`.
import { expect } from "bun:test";
import { createApp as createHubApp } from "../../../../apps/hub-api/src/app";
import type {
  ModelProvider,
  ModelReply,
} from "../../../../apps/hub-api/src/lib/ai-client/ai-client";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import { startFbFake } from "../../FB1/_fbfake";
import {
  call,
  HUB_API_URL,
  type HubDeps,
  makeKeys,
  REDIS_TEST_URL,
  sign,
} from "../../H1/_fixtures";
import { CK, ensureRoles } from "../../HD1/_support/hd1";
import {
  type AdminN1,
  bumpConfig,
  type CtxN1,
  type HubN1,
  P,
  packGroupKey,
  packsPath,
  startAdminN1,
  T,
} from "../../N1/_support/n1";
import { setupX2a } from "../../X2a/_x2a";

export type { CtxN1 };
export { P, T };
// biome-ignore lint/suspicious/noExplicitAny: body JSON của response; mỗi ca tự kiểm
export type Json = any;
export const BASE = "/pack/contracts";

export type AiCall = { model: string; system: string; prompt: string; webSearch: boolean };
export type FakeAi = {
  calls: AiCall[];
  /** Văn bản model trả cho lượt kế (hoặc mã lỗi). */
  next: { text: string } | { code: "REFUSED" | "FAILED" | "UNAVAILABLE" };
  provider: ModelProvider;
};
export function fakeAi(): FakeAi {
  const ai: FakeAi = {
    calls: [],
    next: { text: '{"items":[]}' },
    provider: {
      key: "fake",
      billing: "subscription",
      async complete(r): Promise<ModelReply> {
        ai.calls.push({
          model: r.model,
          system: r.system,
          prompt: r.prompt,
          webSearch: r.webSearch === true,
        });
        const n = ai.next;
        if ("code" in n) return { ok: false, code: n.code };
        const usage = {
          inputTokens: 10,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        };
        return { ok: true, text: n.text, model: r.model, usage };
      },
    },
  };
  return ai;
}

async function startHub(
  k: Awaited<ReturnType<typeof makeKeys>>,
  fb: ReturnType<typeof startFbFake>,
  ai: FakeAi,
) {
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const instanceId = "qc-v2j2-1";
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId,
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 2,
    packs: {
      contracts: true,
      filebox: { url: fb.origin, token: fb.token },
      contractsAi: { model: ai.provider },
    },
  } as HubDeps & Record<string, unknown>;
  const app = createHubApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  return {
    base: `http://localhost:${server.port}`,
    db,
    redis,
    instanceId,
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  } as HubN1;
}

export type CtxJ2 = CtxN1 & { ai: FakeAi };
type Person = (typeof P)[keyof typeof P];

export async function startJ2(): Promise<CtxJ2> {
  const sql = await setupX2a();
  const k = await makeKeys();
  const fb = startFbFake();
  const ai = fakeAi();
  const hub = await startHub(k, fb, ai);
  const admin: AdminN1 = await startAdminN1(k);
  const tok = (p: Person) => sign(k, p);
  const ctx = {
    sql,
    k,
    hub,
    fb,
    admin,
    tok,
    ai,
    hubCall: async (p: Person, method: string, path: string, body?: unknown) =>
      call(hub, method, path, { token: await tok(p), body }),
    enable: async (tenantId: string, key = CK) => {
      const r = await admin.call("PUT", packsPath(tenantId, key));
      expect({ status: r.status }).toEqual({ status: 200 });
      return r.json;
    },
    addToRole: async (tenantId: string, role: string, who: Person[], key = CK) => {
      const [g] = await sql<{ id: string }[]>`select id from admin.groups
        where tenant_id = ${tenantId} and key = ${packGroupKey(key, role)}`;
      expect({ group: packGroupKey(key, role), found: g !== undefined }).toEqual({
        group: packGroupKey(key, role),
        found: true,
      });
      await sql`insert into admin.group_members ${sql(
        who.map((p) => ({ tenant_id: tenantId, group_id: g?.id as string, user_id: p.id })),
      )} on conflict do nothing`;
      await bumpConfig(sql, tenantId);
    },
    stop: async () => {
      await hub.stop();
      await admin.close();
      await fb.close();
      await sql.end();
    },
  } as unknown as CtxJ2;
  await ensureRoles(ctx);
  return ctx;
}

/** Dựng SP + thành phần chính (mode stock, giá vốn BQ) + một lần nhập kho từ NCC (owner, bỏ qua RLS). Trả id SP. */
export async function seedProduct(
  c: CtxJ2,
  o: {
    tenant: string;
    name: string;
    group?: string;
    avgCost?: number;
    supplier?: { key: string; unitCost: number; qty: number };
  },
): Promise<string> {
  const [p] = await c.sql<
    { id: string }[]
  >`insert into contracts.products (tenant_id, name, unit, grp)
    values (${o.tenant}, ${o.name}, 'cái', ${o.group ?? "goods"}) returning id`;
  const pid = p?.id as string;
  const [comp] = await c.sql<{ id: string }[]>`insert into contracts.product_components
    (tenant_id, product_id, ord, name, unit, mode, on_hand, stock_value, avg_cost)
    values (${o.tenant}, ${pid}, 0, ${o.name}, 'cái', ${o.group === "referral" ? "none" : "stock"},
      ${o.avgCost ? 10 : 0}, ${o.avgCost ? o.avgCost * 10 : 0}, ${o.avgCost ?? 0}) returning id`;
  if (o.supplier)
    await c.sql`insert into contracts.stock_moves (id, tenant_id, component_id, direction, reason, qty, unit_cost, amount,
        moved_on, supplier_party_key, created_by)
      values (gen_random_uuid(), ${o.tenant}, ${comp?.id as string}, 'in', 'delivery', ${o.supplier.qty},
        ${o.supplier.unitCost}, ${o.supplier.unitCost * o.supplier.qty}, '2026-10-01', ${o.supplier.key}, ${P.lan.id})`;
  return pid;
}
