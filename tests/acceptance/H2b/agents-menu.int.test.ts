// HUB-FR-92 · HUB-FR-77 · HUB-BR-03 · HUB-H2b-AC-02 · H2b-R11, R15 · plan §2.3, L5, L7 · test-plan H2b §5, cases §2
// A50–A56: `GET /agents` (menu `@`) = AU của user sắp `key`, mỗi item đúng `{key, name{vi,en}, description}`, không lộ cấu
// hình; 401 khi thiếu/hết hạn JWT; thu hồi grant/entitlement → biến mất ≤ 5 s và tag → 404; Orchestrator tenant bị loại ở mọi
// tenant; runtime `llm` không có; đọc cache (DB Hub bị chặn vẫn 200).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { AgentMenuItemSchema, AgentMenuResponseSchema } from "@ai/contracts/chat";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  errorOf,
  type Json,
  type Keys,
  makeKeys,
  type Sql,
  sign,
  T,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import {
  AG,
  block,
  type HubX,
  hubConfigChange,
  insertConv,
  runIdOf,
  send,
  testRedis,
} from "../H1/_hub";
import { echoAnswer, ScriptRuntime } from "../H1/_runtime";
import {
  AG3,
  dropTenantOrch,
  expectAgentNotFound,
  LAN_AU,
  menuKeys,
  settleRuns,
  setupH2b,
  startHubH2b,
  tenantOrch,
} from "./_h2b";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;

beforeAll(async () => {
  sql = await setupH2b();
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);
const menuOf = async (who: UserKey) => menuKeys(hub, await tok(who));
async function tag(who: UserKey, content: string) {
  const conv = await insertConv(sql, who, crypto.randomUUID());
  return call(hub, "POST", `/conversations/${conv}/messages`, {
    token: await tok(who),
    body: { content },
  });
}
/** Chờ menu thoả `ok` (≤ 5 000 ms, spec §6); trả lần đọc cuối. */
const menuWithin = (who: UserKey, ok: (ks: string[]) => boolean) =>
  waitFor(
    () => menuOf(who),
    (ks) => ks !== null && ok(ks),
    5_000,
  );

describe("A50–A52 · nội dung menu [HUB-FR-92 · HUB-H2b-AC-02]", () => {
  it("HUB-FR-92 · A50 · lan GET /agents → AgentMenuResponse; key = [assistant, helper, writer]; mỗi item đúng 3 khoá {key, name{vi,en}, description}; không lộ system_prompt/runtime/profile/workflow/orchestrator [HUB-H2b-AC-02 · H2b-R11]", async () => {
    const res = await call(hub, "GET", "/agents", { token: await tok("lan") });
    expect(res.status).toBe(200);
    const p = AgentMenuResponseSchema.safeParse(res.json);
    expect(p.success).toBe(true);
    const items: Json[] = res.json?.items ?? [];
    expect(items.map((i) => i.key)).toEqual([...LAN_AU]);
    for (const i of items) {
      expect(Object.keys(i).sort()).toEqual(["description", "key", "name"]);
      expect(Object.keys(i.name).sort()).toEqual(["en", "vi"]);
      expect(AgentMenuItemSchema.safeParse(i).success).toBe(true);
    }
    expect(items[0]?.name).toEqual({ vi: "Trợ lý", en: "Assistant" });
    for (const bad of ["system_prompt", "runtime", "profile", "workflow", "orchestrator"])
      expect(res.text).not.toContain(bad);
  });

  it("HUB-FR-92 · A51 · không JWT / JWT hết hạn → 401 AUTH_EXPIRED [HUB-H2b-AC-02 · L7]", async () => {
    expect(errorOf(await call(hub, "GET", "/agents"))).toEqual({
      status: 401,
      code: "AUTH_EXPIRED",
    });
    const expired = await sign(k, USERS.lan, { expS: -60 });
    expect(errorOf(await call(hub, "GET", "/agents", { token: expired }))).toEqual({
      status: 401,
      code: "AUTH_EXPIRED",
    });
  });

  it("HUB-FR-92 · A52 · tadmin (0 grant) → items=[]; an (beta) → [assistant, helper] [HUB-H2b-AC-02 · L5]", async () => {
    expect(await menuOf("tadmin")).toEqual([]);
    expect(await menuOf("an")).toEqual(["assistant", "helper"]);
  });
});

describe("A53–A56 · thu hồi, Orchestrator tenant, runtime, cache [HUB-FR-77 · H2b-R11 · H2b-R15]", () => {
  it("HUB-FR-77 · A53 · thu hồi grant writer (config change + NOTIFY) → mất khỏi menu ≤ 5 s, '@writer x' → 404; thu hồi entitlement helper acme → mất ≤ 5 s [HUB-H2b-AC-02 · H2b-R11]", async () => {
    expect(await menuOf("lan")).toEqual([...LAN_AU]);
    await hubConfigChange(
      sql,
      (tx) =>
        tx`delete from hub.agent_grants where agent_id = ${AG3.writer} and subject_id = ${USERS.lan.id}`,
    );
    await hubConfigChange(
      sql,
      (tx) => tx`update hub.agent_entitlements set revoked_at = now()
        where agent_id = ${AG.helper} and tenant_id = ${T.acme}`,
    );
    try {
      const t0 = Date.now();
      const ks = await menuWithin("lan", (x) => !x.includes("writer") && !x.includes("helper"));
      expect(ks).toEqual(["assistant"]);
      expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
      expectAgentNotFound(await tag("lan", "@writer x"));
    } finally {
      await hubConfigChange(sql, async (tx) => {
        await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
          values (${AG3.writer}, ${T.acme}, 'user', ${USERS.lan.id})`;
        await tx`update hub.agent_entitlements set revoked_at = null
          where agent_id = ${AG.helper} and tenant_id = ${T.acme}`;
      });
      // Dọn sạch: cache Hub nạp lại bất đồng bộ (≤ 5 s) — chờ menu khôi phục để ca sau độc lập.
      await menuWithin("lan", (x) => x.join() === LAN_AU.join());
    }
  });

  it("HUB-BR-03 · A54 · helper là Orchestrator tenant beta → helper mất ở menu lan (acme) và an (beta); '@helper x' → 404; <agents> run thường của lan không có helper [H2b-R15 · HUB-BR-03]", async () => {
    expect(await menuOf("lan")).toEqual([...LAN_AU]);
    await tenantOrch(sql, T.beta, AG.helper);
    try {
      expect(await menuWithin("lan", (x) => !x.includes("helper"))).toEqual([
        "assistant",
        "writer",
      ]);
      expect(await menuWithin("an", (x) => !x.includes("helper"))).toEqual(["assistant"]);
      expectAgentNotFound(await tag("lan", "@helper x"));
      const conv = await insertConv(sql, "lan", crypto.randomUUID());
      const s = await send(hub, await tok("lan"), conv, "Câu thường A54");
      try {
        const job = await rt.next(runIdOf(s));
        const keys = (JSON.parse(block(job.payload.prompt, "agents") ?? "[]") as Json[]).map(
          (a) => a.key,
        );
        expect(keys).not.toContain("helper");
        await rt.decide(job, echoAnswer(job));
      } finally {
        s.close();
      }
    } finally {
      await dropTenantOrch(sql, T.beta);
      // Dọn sạch như A53: chờ cache khôi phục helper trước khi kết thúc.
      await menuWithin("lan", (x) => x.join() === LAN_AU.join());
    }
  });

  it("HUB-FR-92 · A55 · llmbot (runtime llm, có grant) không trong menu; '@llmbot x' → 404 [H2b-R02 · H2b-R11]", async () => {
    const ks = await menuOf("lan");
    expect(ks).not.toBeNull();
    expect(ks).not.toContain("llmbot");
    expectAgentNotFound(await tag("lan", "@llmbot x"));
  });

  it("HUB-FR-92 · A56 · menu đọc cache: khoá ACCESS EXCLUSIVE bảng cấu hình/nhóm/hội thoại (transaction owner mở) → GET /agents vẫn 200 đúng AU trong 1,5 s; đối chứng GET /conversations bị chặn [H2b-R11 · spec §6]", async () => {
    const token = await tok("lan");
    await menuOf("lan");
    const get = (path: string) =>
      fetch(`${hub.base}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(1_500),
      }).then(
        async (r) => ({ status: r.status, json: await r.json().catch(() => null) }),
        () => ({ status: 0, json: null }),
      );
    let release: () => void = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    let locked: () => void = () => {};
    const isLocked = new Promise<void>((r) => {
      locked = r;
    });
    const lockTx = sql.begin(async (tx) => {
      await tx`lock table hub.agents, hub.agent_grants, hub.agent_entitlements, hub.orchestrator_settings,
        admin.group_members, admin.users, hub.conversations in access exclusive mode`;
      locked();
      await held;
    });
    try {
      await isLocked;
      expect((await get("/conversations")).status).toBe(0);
      const res = await get("/agents");
      expect(res.status).toBe(200);
      expect((res.json?.items ?? []).map((i: Json) => i.key)).toEqual([...LAN_AU]);
    } finally {
      release();
      await lockTx;
    }
  });
});
