// HUB-FR-77 · HUB-FR-78 · HUB-FR-60 · CR-054: agent mặc định theo tenant ở Hỏi AI (tin không tag), Orchestrator + agent
// dự phòng, model theo agent, bước có tên agent, cấp "cả công ty", API `/agent-settings` (đặt mặc định, bật/tắt agent),
// danh mục model `/studio/api/models`. Nền H2b (acme: lan, hoa, tam có assistant/helper; tadmin không có grant nào).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type postgres from "postgres";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  type Keys,
  makeKeys,
  type Sql,
  sign,
  T,
  USERS,
  type UserKey,
  waitFor,
} from "../H1/_fixtures";
import { AG, type HubX, hubConfigChange, insertConv, runIdOf, send, testRedis } from "../H1/_hub";
import { ScriptRuntime } from "../H1/_runtime";
import { AG3, dropTenantOrch, settleRuns, setupH2b, startHubH2b, tenantOrch } from "../H2b/_h2b";

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
afterEach(async () => {
  await settleRuns(hub, sql, k);
  await change(async (tx) => {
    await tx`delete from hub.tenant_agent_defaults`;
    await tx`update hub.agents set model = null`;
    await tx`delete from hub.agent_entitlements where agent_id = ${AG.orchestrator}`;
    await tx`delete from hub.agent_grants where subject_type = 'tenant'`;
  });
});
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);

/** Cache cấu hình Hub nạp lại bất đồng bộ: cùng transaction đổi "canh" (grant writer→tam) rồi chờ menu `@` của tam
 * phản ánh ⇒ ảnh mới (nạp nguyên khối) đã có thay đổi `apply`. */
let sentinel = false;
async function change(apply: (tx: postgres.TransactionSql) => Promise<unknown>): Promise<void> {
  sentinel = !sentinel;
  const want = sentinel;
  await hubConfigChange(sql, async (tx) => {
    await apply(tx);
    if (want)
      await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
        values (${AG3.writer}, ${T.acme}, 'user', ${USERS.tam.id})`;
    else
      await tx`delete from hub.agent_grants where agent_id = ${AG3.writer} and subject_id = ${USERS.tam.id}`;
  });
  const keys = async () => {
    const r = await call(hub, "GET", "/agents", { token: await tok("tam") });
    return (r.json?.items ?? []).map((a: { key: string }) => a.key) as string[];
  };
  const got = await waitFor(keys, (ks) => ks.includes("writer") === want, 8_000);
  expect(got.includes("writer")).toBe(want);
}
const setDefaults = (agentId: string, fallback: string | null = null, onNoMatch = "answer") =>
  change(async (tx) => {
    await tx`insert into hub.tenant_agent_defaults (tenant_id, default_agent_id, fallback_agent_id, on_no_match)
      values (${T.acme}, ${agentId}, ${fallback}, ${onNoMatch})`;
  });
const entitleOrchestrator = () =>
  change(async (tx) => {
    await tx`insert into hub.agent_entitlements (agent_id, tenant_id) values (${AG.orchestrator}, ${T.acme})
      on conflict do nothing`;
  });
async function ask(who: UserKey, text: string) {
  const conv = await insertConv(sql, who, crypto.randomUUID());
  return send(hub, await tok(who), conv, text);
}

describe("CR-054 · tin không tag → agent mặc định", () => {
  it("HUB-FR-77 · CR-054 · tenant chưa cấu hình ⇒ như cũ: job đầu là Orchestrator", async () => {
    const s = await ask("lan", "Xin chào");
    expect(s.status).toBe(200);
    const job = await rt.next(runIdOf(s));
    expect(job.payload.agent.role).toBe("orchestrator");
    s.close();
  });

  it("HUB-FR-77 · CR-054 · mặc định = assistant ⇒ run direct tới assistant (responder), model riêng của agent vào job", async () => {
    // Một lần đổi cấu hình (mặc định + model) ⇒ một lần chờ cache.
    await change(async (tx) => {
      await tx`insert into hub.tenant_agent_defaults (tenant_id, default_agent_id, on_no_match)
        values (${T.acme}, ${AG.assistant}, 'answer')`;
      await tx`update hub.agents set model = 'sonnet' where id = ${AG.assistant}`;
    });
    const s = await ask("lan", "Tóm tắt giúp");
    expect(s.status).toBe(200);
    const job = await rt.next(runIdOf(s));
    expect(job.payload.agent).toMatchObject({ key: "assistant", role: "agent" });
    expect(job.payload.model).toBe("sonnet");
    const started = await s.until((e) => e.event === "step.started", 5_000);
    expect(started?.data?.agent).toEqual({
      key: "assistant",
      name: expect.any(String),
      model: "sonnet",
    });
    s.close();
  });

  it("HUB-FR-77 · CR-054 · không được dùng agent mặc định ⇒ 403 DEFAULT_AGENT_FORBIDDEN, không tạo run", async () => {
    await setDefaults(AG.assistant);
    const before = await sql`select count(*)::int as n from hub.runs`;
    const s = await ask("tadmin", "Chào");
    expect(s.status).toBe(403);
    expect(s.json?.error?.code).toBe("DEFAULT_AGENT_FORBIDDEN");
    const after = await sql`select count(*)::int as n from hub.runs`;
    expect(after[0]?.n).toBe(before[0]?.n);
  });

  it("HUB-FR-77 · CR-054 · mặc định = Orchestrator chưa bật cho công ty ⇒ 403; bật ⇒ Orchestrator, prompt giao dự phòng khi không khớp", async () => {
    await setDefaults(AG.orchestrator, AG.helper, "fallback");
    expect((await ask("lan", "Chào")).status).toBe(403);
    await entitleOrchestrator();
    const s = await ask("lan", "Câu hỏi chung");
    expect(s.status).toBe(200);
    const job = await rt.next(runIdOf(s));
    expect(job.payload.agent.role).toBe("orchestrator");
    expect(job.payload.system_prompt).toContain("`delegate` agent `helper`");
    s.close();
  });

  it("HUB-FR-77 · CR-054 · on_no_match=ask ⇒ prompt 'không agent phù hợp → `ask`'; tadmin (không grant nào) vẫn dùng Orchestrator đã bật", async () => {
    await setDefaults(AG.orchestrator, null, "ask");
    await entitleOrchestrator();
    const s = await ask("tadmin", "Hỏi gì đó");
    expect(s.status).toBe(200);
    const job = await rt.next(runIdOf(s));
    expect(job.payload.system_prompt).toContain("không agent phù hợp → `ask`");
    s.close();
  });

  it("HUB-FR-78 · CR-054 · grant 'cả công ty' ⇒ tadmin (không grant riêng) thấy agent trong menu @", async () => {
    await change(async (tx) => {
      await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
        values (${AG.assistant}, ${T.acme}, 'tenant', ${T.acme})`;
    });
    const r = await call(hub, "GET", "/agents", { token: await tok("tadmin") });
    expect(r.status).toBe(200);
    expect((r.json?.items ?? []).map((a: { key: string }) => a.key)).toContain("assistant");
  });

  it("HUB-FR-78 · CR-054 · CHECK: grant 'tenant' phải trỏ đúng tenant của hàng", async () => {
    const bad = sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      values (${AG.assistant}, ${T.acme}, 'tenant', ${T.beta})`;
    expect(
      await bad.then(
        () => "ok",
        (e: { code?: string }) => e.code,
      ),
    ).toBe("23514");
  });

  it("HUB-FR-77 · CR-054 · agent hỏi lại (pending_ask) ⇒ câu trả lời không tag đi Orchestrator (waiting_for), không vào mặc định", async () => {
    await setDefaults(AG.assistant);
    const s = await ask("lan", "Đặt lịch họp");
    const runId = runIdOf(s);
    await rt.agent(await rt.next(runId), {
      status: "need_input",
      question: "Mấy giờ?",
      choices: ["9:00", "14:00"],
    });
    await s.terminal();
    s.close();
    const [r] = await sql`select conversation_id, flow_id from hub.runs where id = ${runId}`;
    const y = await send(
      hub,
      await tok("lan"),
      String(r?.conversation_id),
      "14:00",
      String(r?.flow_id),
    );
    expect(y.status).toBe(200);
    expect((await rt.next(runIdOf(y))).payload.agent.role).toBe("orchestrator");
    y.close();
  });
});

describe("CR-054 · /agent-settings", () => {
  const settings = async (who: UserKey, q = "") =>
    call(hub, "GET", `/agent-settings${q}`, { token: await tok(who) });

  it("HUB-FR-77 · CR-054 · tenant_admin chỉ thấy agent đã bật cho công ty (không lộ catalog / Orchestrator tenant khác); platform_admin thấy catalog + đúng Orchestrator chạy cho T; member ⇒ 403", async () => {
    await hubConfigChange(
      sql,
      (tx) => tx`update hub.agents set model = 'haiku' where id = ${AG.orchestrator}`,
    );
    const keys = (r: { json: { agents: { agent: { key: string } }[] } }) =>
      r.json.agents.map((a) => a.agent.key);
    const t0 = await settings("tadmin");
    expect(t0.status).toBe(200);
    expect(t0.json.defaults).toBeNull();
    expect(keys(t0)).not.toContain("orchestrator");
    for (const a of t0.json.agents) expect(a.entitled).toBe(true);
    for (const k of ["orch-acme", "orch-alt"]) expect(keys(t0)).not.toContain(k);
    await entitleOrchestrator();
    const orch = (await settings("tadmin")).json.agents.find(
      (a: { agent: { key: string } }) => a.agent.key === "orchestrator",
    );
    expect(orch).toMatchObject({
      is_orchestrator: true,
      entitled: true,
      model: { value: "haiku" },
    });
    const p0 = await settings("padmin", `?tenant_id=${T.acme}`);
    expect(keys(p0)).toContain("orchestrator");
    await tenantOrch(sql, T.acme, AG3.orchAcme);
    try {
      const p1 = await settings("padmin", `?tenant_id=${T.acme}`);
      expect(keys(p1)).toContain("orch-acme");
      expect(keys(p1)).not.toContain("orchestrator");
    } finally {
      await dropTenantOrch(sql, T.acme);
    }
    expect((await settings("lan")).status).toBe(403);
  });

  it("HUB-FR-77 · CR-054 · PUT default: agent chưa bật ⇒ 409 NOT_ENTITLED; hợp lệ ⇒ lưu + bump; mặc định thường ⇒ bỏ dự phòng", async () => {
    const put = async (body: unknown) =>
      call(hub, "PUT", "/agent-settings/default", { token: await tok("tadmin"), body });
    const no = await put({
      default_agent_id: AG.orchestrator,
      fallback_agent_id: null,
      on_no_match: "answer",
    });
    expect(no.status).toBe(409);
    expect(no.json?.error?.code).toBe("NOT_ENTITLED");
    const ok = await put({
      default_agent_id: AG.assistant,
      fallback_agent_id: AG.helper,
      on_no_match: "fallback",
    });
    expect(ok.status).toBe(200);
    const [row] =
      await sql`select default_agent_id, fallback_agent_id, on_no_match from hub.tenant_agent_defaults
      where tenant_id = ${T.acme}`;
    expect(row).toEqual({
      default_agent_id: AG.assistant,
      fallback_agent_id: null,
      on_no_match: "answer",
    });
    const audit =
      await sql`select entity, action from hub.audit_log where entity = 'agent_default'`;
    expect(audit.length).toBeGreaterThan(0);
    // Orchestrator + on_no_match ≠ fallback ⇒ không lưu id dự phòng (kể cả id rác) — không chặn tắt agent đó.
    await entitleOrchestrator();
    const ask2 = await put({
      default_agent_id: AG.orchestrator,
      fallback_agent_id: crypto.randomUUID(),
      on_no_match: "ask",
    });
    expect(ask2.status).toBe(200);
    const [r2] = await sql`select fallback_agent_id, on_no_match from hub.tenant_agent_defaults
      where tenant_id = ${T.acme}`;
    expect(r2).toEqual({ fallback_agent_id: null, on_no_match: "ask" });
    const bad = await put({
      default_agent_id: AG.orchestrator,
      fallback_agent_id: crypto.randomUUID(),
      on_no_match: "fallback",
    });
    expect(bad.status).toBe(400);
    expect(bad.json?.error?.details).toEqual({ field: "fallback_agent_id" });
  });

  it("HUB-FR-78 · CR-054 · PUT entitlements: tenant_admin ⇒ 403; platform_admin bật Orchestrator; tắt agent đang mặc định ⇒ 409 AGENT_IS_DEFAULT", async () => {
    const put = async (who: UserKey, body: unknown) =>
      call(hub, "PUT", `/agent-settings/entitlements?tenant_id=${T.acme}`, {
        token: await tok(who),
        body,
      });
    expect((await put("tadmin", { agent_id: AG.orchestrator, entitled: true })).status).toBe(403);
    const on = await put("padmin", { agent_id: AG.orchestrator, entitled: true });
    expect(on.status).toBe(200);
    const [e] = await sql`select revoked_at from hub.agent_entitlements
      where agent_id = ${AG.orchestrator} and tenant_id = ${T.acme}`;
    expect(e?.revoked_at).toBeNull();
    await setDefaults(AG.orchestrator);
    const off = await put("padmin", { agent_id: AG.orchestrator, entitled: false });
    expect(off.status).toBe(409);
    expect(off.json?.error?.code).toBe("AGENT_IS_DEFAULT");
  });
});

describe("CR-054 · Agent Forge", () => {
  it("HUB-FR-77 · CR-054 · tắt agent đang là mặc định của công ty ⇒ 409 AGENT_IS_DEFAULT", async () => {
    await setDefaults(AG.assistant);
    const [a] = await sql`select version from hub.agents where id = ${AG.assistant}`;
    const r = await call(hub, "PATCH", `/studio/api/agents/${AG.assistant}/enabled`, {
      token: await tok("padmin"),
      body: { enabled: false, version: a?.version },
    });
    expect(r.status).toBe(409);
    expect(r.json?.error?.code).toBe("AGENT_IS_DEFAULT");
  });
});

describe("CR-054 · /studio/api/models", () => {
  it("HUB-FR-60 · CR-054 · trả danh mục Runtime ghi (thứ tự theo position); member ⇒ 403", async () => {
    await sql`delete from hub.provider_models`;
    const [p] = await sql`select key from hub.providers order by key limit 1`;
    const key = String(p?.key);
    await sql`insert into hub.provider_models (provider_key, value, resolved_model, display_name, description, position)
      values (${key}, 'sonnet', 'claude-sonnet-x', 'Sonnet X', 'Cân bằng', 1),
             (${key}, 'haiku', 'claude-haiku-x', 'Haiku X', '', 0)`;
    const r = await call(hub, "GET", "/studio/api/models", { token: await tok("padmin") });
    expect(r.status).toBe(200);
    expect(r.json.items.map((m: { value: string }) => m.value)).toEqual(["haiku", "sonnet"]);
    expect(r.json.items[1]).toMatchObject({
      provider_key: key,
      resolved_model: "claude-sonnet-x",
      display_name: "Sonnet X",
    });
    expect((await call(hub, "GET", "/studio/api/models", { token: await tok("lan") })).status).toBe(
      403,
    );
  });
});
