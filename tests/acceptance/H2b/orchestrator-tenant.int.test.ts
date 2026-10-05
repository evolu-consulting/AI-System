// HUB-FR-62 · HUB-BR-08 · HUB-BR-06 · AC-H16 (vế runtime) · HUB-H2b-AC-10 · H2b-R14, R15 · plan §5.3, P6, P7 · plan-errors §3
// · test-plan H2b §5, cases §2 A60–A67: Orchestrator theo tenant — run `orchestrated` của tenant có bản riêng hợp lệ dùng
// agent + `max_steps` của bản đó, ghi `runs.orchestrator_tenant_id`; tenant khác/bản bị xoá → mặc định; chốt lúc tạo run
// (đổi giữa run không ảnh hưởng); bản hỏng → mặc định + `warn orchestrator_tenant_invalid`; Hub vẫn khởi động; agent
// Orchestrator tenant không vào menu/không tag được; run `direct` không ghi tenant. Bản tenant dựng bằng SQL owner (P6).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  HUB_API_URL,
  type Json,
  type Keys,
  makeKeys,
  REDIS_TEST_URL,
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
  runRow,
  type Sse,
  send,
  testRedis,
} from "../H1/_hub";
import { type Job, ScriptRuntime } from "../H1/_runtime";
import {
  AG3,
  captureLogs,
  dropTenantOrch,
  expectAgentNotFound,
  menuKeys,
  settleRuns,
  setupH2b,
  startHubH2b,
  tenantOrch,
} from "./_h2b";

const REPO = resolve(import.meta.dir, "../../..");
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
  await dropTenantOrch(sql, T.acme);
  await dropTenantOrch(sql, T.beta);
});
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

const tok = (who: UserKey) => sign(k, USERS[who]);
type Run = { s: Sse; runId: string };
async function start(who: UserKey, content: string): Promise<Run> {
  const conv = await insertConv(sql, who, crypto.randomUUID());
  const s = await send(hub, await tok(who), conv, content);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s) };
}
async function cancelRun(who: UserKey, runId: string): Promise<void> {
  await call(hub, "POST", `/runs/${runId}/cancel`, { token: await tok(who) });
  await waitFor(
    async () => (await runRow(sql, runId))?.status,
    (st) => st !== "running",
    5_000,
  );
}
/** Run thăm dò: key agent của job Orchestrator đầu tiên + run id; run bị huỷ ngay. */
async function probe(who: UserKey): Promise<{ key: string; runId: string }> {
  const x = await start(who, "Dò Orchestrator");
  const job = await rt.next(x.runId);
  x.s.close();
  await cancelRun(who, x.runId);
  return { key: job.payload.agent.key, runId: x.runId };
}
/** Chờ cache nạp bản mới (≤ 5 s): thăm dò tới khi key Orchestrator = `want`. */
const orchWithin = (who: UserKey, want: string) =>
  waitFor(
    () => probe(who),
    (p) => p.key === want,
    5_000,
  );
const stepsLeft = (j: Job) => Number(block(j.payload.prompt, "steps_left"));

/** Chạy run tới hết: Orchestrator luôn delegate `hoadon` (ngoài AU → bị bỏ); trả key các job Orchestrator. */
async function exhaust(x: Run, first?: Job): Promise<string[]> {
  const keys: string[] = [];
  const handle = async (job: Job) => {
    if (job.payload.agent.role === "orchestrator") keys.push(job.payload.agent.key);
    await rt.decide(job, { decision: "delegate", agent: "hoadon", task: "Tra" });
  };
  if (first) await handle(first);
  await rt.serve(x.runId, handle);
  const end = await x.s.terminal(15_000);
  x.s.close();
  expect(end).toBeDefined();
  return keys;
}
const stepCount = async (runId: string): Promise<number> => {
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from hub.run_steps
    where run_id = ${runId}`;
  return r?.n ?? 0;
};

describe("A60–A63 · chọn Orchestrator theo tenant lúc tạo run [AC-H16 · H2b-R14]", () => {
  it("HUB-FR-62 · A60 · bản acme = orch-acme, max_steps=3 → run lan: mọi job Orchestrator key orch-acme, steps_left đầu = 3, runs.orchestrator_tenant_id = acme, ≤ 3 bước; an cùng kịch bản: mặc định, steps_left 5 [AC-H16 · H2b-R14]", async () => {
    await tenantOrch(sql, T.acme, AG3.orchAcme, { maxSteps: 3 });
    expect((await orchWithin("lan", "orch-acme")).key).toBe("orch-acme");
    const x = await start("lan", "Việc dài A60");
    const first = await rt.next(x.runId);
    expect(stepsLeft(first)).toBe(3);
    expect(first.payload.agent.id).toBe(AG3.orchAcme);
    const keys = await exhaust(x, first);
    expect(new Set(keys)).toEqual(new Set(["orch-acme"]));
    expect((await runRow(sql, x.runId))?.orchestrator_tenant_id).toBe(T.acme);
    expect(await stepCount(x.runId)).toBeLessThanOrEqual(3);

    const y = await start("an", "Việc dài A60 beta");
    const f2 = await rt.next(y.runId);
    expect(stepsLeft(f2)).toBe(5);
    const keys2 = await exhaust(y, f2);
    expect(new Set(keys2)).toEqual(new Set(["orchestrator"]));
    expect(keys2.length).toBeGreaterThan(keys.length);
  }, 60_000);

  it("HUB-FR-62 · A61 · an (beta, không bản riêng) khi acme có bản riêng → Orchestrator mặc định, orchestrator_tenant_id NULL [AC-H16 · H2b-R14]", async () => {
    await tenantOrch(sql, T.acme, AG3.orchAcme, { maxSteps: 3 });
    const p = await probe("an");
    expect(p.key).toBe("orchestrator");
    expect((await runRow(sql, p.runId))?.orchestrator_tenant_id).toBeNull();
  });

  it("HUB-FR-62 · A62 · xoá bản acme → lượt kế của lan dùng mặc định (orchestrator_tenant_id NULL) [AC-H16 · H2b-R13]", async () => {
    await tenantOrch(sql, T.acme, AG3.orchAcme);
    expect((await orchWithin("lan", "orch-acme")).key).toBe("orch-acme");
    await dropTenantOrch(sql, T.acme);
    const p = await orchWithin("lan", "orchestrator");
    expect(p.key).toBe("orchestrator");
    expect((await runRow(sql, p.runId))?.orchestrator_tenant_id).toBeNull();
  });

  it("HUB-BR-06 · A63 · run lan đang chạy (bước 1, orch-acme/3) → đổi bản acme sang orch-alt/5 → job Orchestrator sau của run đó vẫn orch-acme, ≤ 3 bước; run mới dùng orch-alt [AC-H16 · HUB-BR-06 · P7]", async () => {
    await tenantOrch(sql, T.acme, AG3.orchAcme, { maxSteps: 3 });
    expect((await orchWithin("lan", "orch-acme")).key).toBe("orch-acme");
    const x = await start("lan", "Run giữ snapshot A63");
    const first = await rt.next(x.runId);
    expect(first.payload.agent.key).toBe("orch-acme");
    await tenantOrch(sql, T.acme, AG3.orchAlt, { maxSteps: 5 });
    const keys = await exhaust(x, first);
    expect(new Set(keys)).toEqual(new Set(["orch-acme"]));
    expect(await stepCount(x.runId)).toBeLessThanOrEqual(3);
    expect((await orchWithin("lan", "orch-alt")).key).toBe("orch-alt");
  }, 60_000);
});

describe("A64–A67 · bản tenant hỏng, khởi động, loại khỏi AU, run direct [H2b-R14 · H2b-R15 · HUB-H2b-AC-10]", () => {
  it("HUB-FR-62 · A64 · bản acme trỏ agent bị tắt → run lan dùng mặc định, orchestrator_tenant_id NULL, warn orchestrator_tenant_invalid {run_id, tenant_id, agent_id} [HUB-H2b-AC-10 · H2b-R14]", async () => {
    await tenantOrch(sql, T.acme, AG3.orchAcme);
    expect((await orchWithin("lan", "orch-acme")).key).toBe("orch-acme");
    await hubConfigChange(
      sql,
      (tx) => tx`update hub.agents set enabled = false where id = ${AG3.orchAcme}`,
    );
    const log = captureLogs();
    try {
      const p = await orchWithin("lan", "orchestrator");
      expect(p.key).toBe("orchestrator");
      expect((await runRow(sql, p.runId))?.orchestrator_tenant_id).toBeNull();
      const hit = log.lines.find(
        (l) => l.rec.msg === "orchestrator_tenant_invalid" && l.rec.run_id === p.runId,
      );
      expect(hit?.level).toBe("warn");
      expect(hit?.rec).toMatchObject({ tenant_id: T.acme, agent_id: AG3.orchAcme });
    } finally {
      log.restore();
      await hubConfigChange(
        sql,
        (tx) => tx`update hub.agents set enabled = true where id = ${AG3.orchAcme}`,
      );
    }
  }, 30_000);

  it("HUB-BR-08 · A65 · bản acme hỏng (agent tắt), mặc định đúng → server.ts khởi động, /health 200 [H2b-R15 · HUB-BR-08]", async () => {
    await tenantOrch(sql, T.acme, AG3.orchAlt);
    await hubConfigChange(
      sql,
      (tx) => tx`update hub.agents set enabled = false where id = ${AG3.orchAlt}`,
    );
    const port = 42_000 + (process.pid % 1000);
    const proc = Bun.spawn(["bun", "apps/hub-api/src/server.ts"], {
      cwd: REPO,
      env: {
        ...process.env,
        APP_ENV: "test",
        HUB_PORT: String(port),
        HUB_DATABASE_URL: HUB_API_URL,
        REDIS_URL: REDIS_TEST_URL,
        JWT_PUBLIC_KEY: k.publicPem,
        HUB_INSTANCE_ID: "qc-boot-a65",
        LOG_LEVEL: "info",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const health = await waitFor(
        () =>
          fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1_000) })
            .then((r) => r.status)
            .catch(() => 0),
        (st) => st === 200 || proc.exitCode !== null,
        10_000,
      );
      expect(proc.exitCode).toBeNull();
      expect(health).toBe(200);
    } finally {
      proc.kill();
      await proc.exited;
      await hubConfigChange(
        sql,
        (tx) => tx`update hub.agents set enabled = true where id = ${AG3.orchAlt}`,
      );
    }
  }, 30_000);

  it("HUB-BR-03 · A66 · orch-acme (có grant lan/an) là Orchestrator tenant acme → không trong menu an/lan, '@orch-acme x' → 404 [H2b-R15 · HUB-BR-03]", async () => {
    await hubConfigChange(sql, async (tx) => {
      await tx`insert into hub.agent_entitlements (agent_id, tenant_id) values
        (${AG3.orchAcme}, ${T.acme}), (${AG3.orchAcme}, ${T.beta})`;
      await tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id) values
        (${AG3.orchAcme}, ${T.acme}, 'user', ${USERS.lan.id}), (${AG3.orchAcme}, ${T.beta}, 'user', ${USERS.an.id})`;
    });
    await tenantOrch(sql, T.acme, AG3.orchAcme);
    try {
      // Hai thay đổi cấu hình liền nhau: chờ cache nạp bản tenant (thay đổi cuối, snapshot gồm cả grant) — "menu
      // không có orch-acme" thoả cả khi cache chưa nạp gì nên không đủ làm điều kiện chờ (qc TC A66, B7-5).
      expect((await orchWithin("lan", "orch-acme")).key).toBe("orch-acme");
      for (const who of ["lan", "an"] as const) {
        const ks = await waitFor(
          async () => menuKeys(hub, await tok(who)),
          (x) => x !== null && !x.includes("orch-acme"),
          5_000,
        );
        expect(ks).not.toBeNull();
        expect(ks).not.toContain("orch-acme");
        const conv = await insertConv(sql, who, crypto.randomUUID());
        const res = await call(hub, "POST", `/conversations/${conv}/messages`, {
          token: await tok(who),
          body: { content: "@orch-acme x" },
        });
        expectAgentNotFound(res);
      }
    } finally {
      await hubConfigChange(sql, async (tx) => {
        await tx`delete from hub.agent_grants where agent_id = ${AG3.orchAcme}`;
        await tx`delete from hub.agent_entitlements where agent_id = ${AG3.orchAcme}`;
      });
    }
  });

  it("HUB-FR-62 · A67 · bản acme có hiệu lực, run direct ('@assistant x') → kind direct, orchestrator_tenant_id NULL [H2b-R14 · runs_orch_tenant_ck]", async () => {
    await tenantOrch(sql, T.acme, AG3.orchAcme);
    expect((await orchWithin("lan", "orch-acme")).key).toBe("orch-acme");
    const x = await start("lan", "@assistant x");
    const job = await rt.next(x.runId);
    expect(job.payload.agent).toMatchObject({ id: AG.assistant, role: "agent" });
    const row: Json = await runRow(sql, x.runId);
    expect(row).toMatchObject({ kind: "direct", orchestrator_tenant_id: null });
    x.s.close();
  });
});
