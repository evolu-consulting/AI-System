// HUB-FR-109 · AC-H31 · P1-60…P1-63 (test-plan-int §2): stage `real_action` sau cổng kiểm đã Đạt ⇒ Hub xác nhận trước
// (`tool_confirmations` confirmed, `decided_run_id` = run stage 2, audit `authorize_real_action` actor = người Đạt); tool
// side_effect `ghi-so` gọi Dify đúng 1 lần; gọi lần 2 / def lách luật ⇒ `CONFIRMATION_REQUIRED`; kick song song 2 instance ⇒ 1 run.
// Hạ tầng tool: mock Dify + catalog H2a (`insertCatalog`), workflow `ghi-so` = bản sao `create-trello-card` (side_effect,
// input `title`) gắn agent `hd-post`. Hub dựng TẠI ĐÂY (cần deps MCP H2a: `secretMasterKey`, `internalToken`,
// `publicInternalUrl`) — `startPf1` không có deps đó; launcher PF1 thật, `processLoops:false`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import { HUB_API_URL, type HubDeps, makeKeys, REDIS_TEST_URL, sign } from "../../H1/_fixtures";
import { testRedis } from "../../H1/_hub";
import { ScriptRuntime } from "../../H1/_runtime";
import {
  type Dify,
  INTERNAL_TOKEN,
  insertCatalog,
  markSideEffect,
  startDify,
  TEST_MASTER_KEY_B64,
  WF,
} from "../../H2a/_h2a";
import { isConfirmation, toolCall } from "../../H2a/_h2a2";
import { newJobToken, tokenHash } from "../../H2a/_runtime2";
import { api, type HubPa, type Json, PA, type Role, setupPa, waitFor } from "../_support/pa";
import { needSchema } from "../_support/schema";
import {
  type CtxPf1,
  DEFS,
  handles,
  insertDefPf1,
  type Job,
  jobAsk,
  jobDone,
  nextStageJob,
  P1,
  review,
  secondHub,
  seedPf1,
  stageHubRuns,
  stageRow,
  startInRoom,
  toGate,
  waitStatus,
} from "./_local";

const GHI_SO = "a5a10000-0000-4000-8000-000000000901";
const DEF_LACH = "a5a10000-0000-4000-8000-000000000902";
const STAGE0_MD = "## Bảng ý\nHoá đơn HD-12.\n\n## Số tiền\n12 000 000";

let c: CtxPf1;
let dify: Dify;
const extra: HubPa[] = [];

async function startHub(k: Awaited<ReturnType<typeof makeKeys>>): Promise<HubPa> {
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const server = Bun.serve({
    port: 0,
    idleTimeout: 0,
    fetch: () => new Response("starting", { status: 503 }),
  });
  const base = `http://localhost:${server.port}`;
  let h: Json | null = null;
  const deps: Record<string, unknown> = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId: "qc-pf1-ra",
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 4,
    secretMasterKey: TEST_MASTER_KEY_B64,
    internalToken: INTERNAL_TOKEN,
    difyTimeoutMaxS: 300,
    publicInternalUrl: base,
    processEngine: true,
    processLoops: false,
    onProcessHandles: (x: Json) => {
      h = x;
    },
  };
  const app = createApp(
    { version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] },
    deps as HubDeps,
  );
  server.reload({ fetch: app.fetch });
  return {
    base,
    db,
    redis,
    instanceId: "qc-pf1-ra",
    handles: () => h,
    kicks: [],
    stop: async () => {
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      await db.close();
    },
  };
}

beforeAll(async () => {
  const { sql, ready } = await setupPa();
  dify = startDify();
  if (ready) {
    await seedPf1(sql);
    await insertCatalog(sql, { baseUrl: dify.baseUrl });
    await sql`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id, input_schema,
        output_field, enabled)
      select ${GHI_SO}, 'ghi-so', 'WFNAME-ghi-so-qc', 'Ghi sổ kế toán (thử P-a).', app_type, base_url, secret_id,
        input_schema, output_field, true from admin.workflows where id = ${WF.trello}`;
    await markSideEffect(sql, GHI_SO);
    await sql`insert into hub.agent_workflows (agent_id, workflow_id) values (${P1.agPost}, ${GHI_SO})`;
    // Def lách luật (P1-62): stage 2 `real_action` sau stage `auto` — chèn SQL, bỏ qua `validateProcessDef`.
    await insertDefPf1(sql, {
      id: DEF_LACH,
      key: "p-lach",
      name: "Lách luật thử",
      stages: [DEFS.auto.stages[0] as Json, DEFS.hd.stages[1] as Json],
    });
    await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  }
  const k = await makeKeys();
  const hub = await startHub(k);
  const redis = await testRedis();
  const tok = (r: Role) => sign(k, PA[r]);
  c = {
    sql,
    ready,
    k,
    hub,
    redis,
    rt: new ScriptRuntime(sql, redis),
    tok,
    call: async (r, method, path, body) => api(hub, await tok(r), method, path, body),
    stop: async () => {
      await hub.stop();
      redis.disconnect();
      await sql.end();
    },
  };
}, 60_000);
afterAll(async () => {
  for (const h of extra) await h.stop();
  await c?.stop();
  await dify?.close();
});

/** Lời gọi MK của workflow `ghi-so` (input `title`). */
const ghiSoCalls = () =>
  dify.runs().filter((x) => {
    const inputs = (x.body as { inputs?: Record<string, unknown> } | null)?.inputs;
    return !!inputs && "title" in inputs;
  }).length;
/** Gắn token cho job Hub tạo (như Runtime RT1) rồi gọi `ghi-so`. */
async function callGhiSo(job: Job, token?: string): Promise<{ token: string; result: Json }> {
  const t = token ?? newJobToken();
  if (!token) await c.sql`update hub.jobs set token_hash = ${tokenHash(t)} where id = ${job.id}`;
  const { result } = await toolCall(c.hub, t, "ghi-so", { title: "Ghi sổ HD-12" });
  return { token: t, result };
}
/** Run tới stage 2 đang có job: A bắt đầu, stage 1 xong, B Đạt. */
async function toStage2(): Promise<{ runId: string; job: Job; stage2RunId: string }> {
  const g = await toGate(c);
  const r = await review(c, "B", g.taskId, { result: "pass" });
  expect(r.status).toBe(200);
  const job = await nextStageJob(c, g.runId);
  const s1 = await stageRow(c.sql, g.runId, 1);
  const runs = await stageHubRuns(c.sql, g.runId);
  const stage2 = runs.find((x) => x.stage_run_id === s1.id);
  expect(stage2).toBeDefined();
  expect(job.runId).toBe(stage2?.id);
  return { runId: g.runId, job, stage2RunId: stage2?.id };
}

describe("P1-60…P1-63 · real_action [AC-H31 · HUB-FR-109]", () => {
  it("AC-H31 · P1-60 · B Đạt stage 1 ⇒ `tool_confirmations` confirmed cho run stage 2; `ghi-so` gọi Dify 1 lần; A không nhận ask; audit `authorize_real_action` actor B", async () => {
    needSchema(c.ready);
    dify.mock.reset();
    const s = await toStage2();
    const conf = await c.sql<
      Json[]
    >`select status, decided_run_id, workflow_id, agent_id from hub.tool_confirmations
      where decided_run_id = ${s.stage2RunId}`;
    expect(conf).toHaveLength(1);
    expect(conf[0]).toMatchObject({
      status: "confirmed",
      workflow_id: GHI_SO,
      agent_id: P1.agPost,
    });
    const { result } = await callGhiSo(s.job);
    expect(isConfirmation(result)).toBe(false);
    expect(result?.isError ?? false).toBe(false);
    expect(ghiSoCalls()).toBe(1);
    const asks = await c.sql<
      Json[]
    >`select id from hub.review_tasks where process_run_id = ${s.runId} and kind = 'ask'`;
    expect(asks).toHaveLength(0);
    const audit = await c.sql<Json[]>`select actor_id, entity, entity_id from hub.audit_log
      where action = 'authorize_real_action' and entity_id = ${s.runId}`;
    expect(audit.map((a) => a.actor_id)).toEqual([PA.B.id]);
    await jobDone(c, s.job, "## Kết quả\nĐã ghi sổ HD-12.");
    await waitStatus(c.sql, s.runId, "done");
  }, 60_000);

  it("AC-H31 · P1-61 · job stage 2 gọi `ghi-so` lần 2 ⇒ CONFIRMATION_REQUIRED, Dify vẫn 1 lần", async () => {
    needSchema(c.ready);
    dify.mock.reset();
    const s = await toStage2();
    const first = await callGhiSo(s.job);
    expect(isConfirmation(first.result)).toBe(false);
    const second = await callGhiSo(s.job, first.token);
    expect(isConfirmation(second.result)).toBe(true);
    expect(ghiSoCalls()).toBe(1);
    await jobDone(c, s.job, "## Kết quả\nĐã ghi sổ HD-12.");
    await waitStatus(c.sql, s.runId, "done");
  }, 60_000);

  it("AC-H31 · P1-62 · def lách luật (real_action sau stage auto) ⇒ không xác nhận trước; tool ⇒ CONFIRMATION_REQUIRED; run needs_decision; Dify 0", async () => {
    needSchema(c.ready);
    dify.mock.reset();
    const st = await startInRoom(c, { key: "p-lach" });
    const j0 = await nextStageJob(c, st.runId);
    await jobDone(c, j0, STAGE0_MD);
    const j1 = await nextStageJob(c, st.runId);
    const confirmed = await c.sql<Json[]>`select id from hub.tool_confirmations
      where decided_run_id = ${j1.runId} and status = 'confirmed'`;
    expect(confirmed).toHaveLength(0);
    const { result } = await callGhiSo(j1);
    expect(isConfirmation(result)).toBe(true);
    const sc = result?.structuredContent ?? {};
    await jobAsk(c, j1, String(sc.question ?? "Xác nhận?"), (sc.choices as string[]) ?? []);
    await waitStatus(c.sql, st.runId, "needs_decision");
    expect(ghiSoCalls()).toBe(0);
  }, 60_000);

  it("AC-H31 · P1-63 · `kick` 2 lần song song (2 instance) ⇒ 1 `hub.runs` stage 2 (`current_run_id` idempotent), Dify 1 lần", async () => {
    needSchema(c.ready);
    dify.mock.reset();
    const h2 = await secondHub(c);
    extra.push(h2);
    const g = await toGate(c);
    const r = await review(c, "B", g.taskId, { result: "pass" });
    expect(r.status).toBe(200);
    const h2h = await waitFor(
      async () => h2.handles(),
      (v) => v !== null,
      3_000,
    );
    expect(typeof h2h?.kick).toBe("function");
    await Promise.all([handles(c).kick(g.runId), h2h.kick(g.runId), handles(c).kick(g.runId)]);
    const s1 = await stageRow(c.sql, g.runId, 1);
    const runs = (await stageHubRuns(c.sql, g.runId)).filter((x) => x.stage_run_id === s1.id);
    expect(runs).toHaveLength(1);
    expect((await stageRow(c.sql, g.runId, 1)).current_run_id).toBe(runs[0]?.id);
    const job = await nextStageJob(c, g.runId);
    expect(job.runId).toBe(runs[0]?.id);
    await callGhiSo(job);
    expect(ghiSoCalls()).toBe(1);
    await jobDone(c, job, "## Kết quả\nĐã ghi sổ HD-12.");
    await waitStatus(c.sql, g.runId, "done");
  }, 60_000);
});
