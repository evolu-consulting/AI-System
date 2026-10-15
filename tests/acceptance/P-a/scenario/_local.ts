// HUB-FR-104…117 · kịch bản seed (test-plan-int §7; chỉ cổng merge PF4 + `done:pa`): helper RIÊNG thư mục `scenario/` (không sửa
// `_support`). Khác `startPa`: hub-api THẬT không seam (`processLoops` mặc định bật, `stageLauncher` thật, không `now` giả) để
// chạy trọn quy trình; Runtime giả TỰ ĐỘNG (`autoRuntime`) trả lời mọi job stage (`runs.process_run_id`) bằng md đủ mục bắt buộc
// của stage (snapshot) trừ khi kịch bản chỉ định (`ask` / `missing`), ghi `usage_logs` như Runtime thật. Không chứa `it(...)`.
import { createApp } from "../../../../apps/hub-api/src/app";
import { connectDb, pingDb } from "../../../../apps/hub-api/src/lib/db";
import { createRedis, pingRedis } from "../../../../apps/hub-api/src/lib/redis";
import {
  HUB_API_URL,
  type HubDeps,
  makeKeys,
  OWNER_URL,
  REDIS_TEST_URL,
  sign,
  T,
} from "../../H1/_fixtures";
import { testRedis } from "../../H1/_hub";
import { type Job, ScriptRuntime } from "../../H1/_runtime";
import { api } from "../../X2a/_x2a";
import { fn, loadSeed } from "../_support/modules";
import { type Json, PA, PA_FIX, type Res, type Role, type Sql, setupPa } from "../_support/pa";

export type Step =
  | { kind: "done" }
  | { kind: "missing" }
  | { kind: "ask"; question: string; choices: string[] };
export type Handled = {
  processRunId: string;
  stageIdx: number;
  jobId: string;
  userId: string;
  kind: Step["kind"];
};

export type Scenario = {
  sql: Sql;
  ready: boolean;
  tok: (r: Role) => Promise<string>;
  call: (r: Role, method: string, path: string, body?: unknown) => Promise<Res>;
  /** kịch bản theo `stage_idx` (hàng đợi; hết ⇒ `done`). */
  script: Map<number, Step[]>;
  handled: Handled[];
  stop: () => Promise<void>;
};

const md = (sections: string[]) =>
  sections.map((s) => `## ${s}\nNội dung ${s}.\n`).join("\n") || "## Kết quả\nxong.\n";

/** DB sạch P-a + hub thật + runtime tự động. Bảng 0019 vắng ⇒ `ready=false` (ca đỏ ở `needSchema`). */
export async function startScenario(): Promise<Scenario> {
  const { sql, ready } = await setupPa();
  const k = await makeKeys();
  const db = connectDb(HUB_API_URL, 8);
  const redis = createRedis(REDIS_TEST_URL);
  await redis.connect();
  const ac = new AbortController();
  const deps = {
    probes: [() => pingDb(db), () => pingRedis(redis)],
    db,
    redis,
    jwtPublicKey: k.publicKey,
    appEnv: "test",
    instanceId: "qc-pa-scenario",
    signal: ac.signal,
    pingMs: 500,
    jobMaxWaitS: 30,
    maxConcurrentRuns: 4,
    processEngine: true,
  } as HubDeps & Record<string, unknown>;
  const app = createApp({ version: "0.0.0-test", corsOrigins: ["http://localhost:3100"] }, deps);
  const server = Bun.serve({ port: 0, fetch: app.fetch, idleTimeout: 0 });
  const hub = { base: `http://localhost:${server.port}`, db, redis, instanceId: "qc-pa-scenario" };
  const rtRedis = await testRedis();
  const rt = new ScriptRuntime(sql, rtRedis);
  const tok = (r: Role) => sign(k, PA[r]);
  const script = new Map<number, Step[]>();
  const handled: Handled[] = [];
  let busy = false;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: vòng runtime giả đọc tuần tự (claim → usage → trả lời)
  const tick = async () => {
    if (busy || !ready) return;
    busy = true;
    try {
      const rows = await sql<Json[]>`
        select j.run_id, r.process_run_id, sr.stage_idx,
          (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(
            pr.snapshot->'stages'->(sr.stage_idx::int)->'output'->'required_sections') x) as sections
        from hub.jobs j join hub.runs r on r.id = j.run_id
        join hub.stage_runs sr on sr.id = r.stage_run_id
        join hub.process_runs pr on pr.id = r.process_run_id
        where j.status = 'queued' and r.process_run_id is not null order by j.created_at limit 5`;
      for (const row of rows) {
        const job: Job = await rt.next(row.run_id, 1_000);
        const q = script.get(row.stage_idx);
        const step: Step = q?.shift() ?? { kind: "done" };
        const p = job.payload as Json;
        await sql`insert into hub.usage_logs (tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key,
            model, billing, input_tokens, output_tokens, cost_usd, overage, latency_ms, job_id)
          values (${p.tenant_id}, ${p.run_id}, ${p.step_id ?? null}, ${p.user_id}, null, ${p.agent?.id ?? null},
            ${p.provider_key ?? "fake-cli"}, 'fake-1', 'subscription', 100, 20, 0, false, 10, ${job.id})
          on conflict (job_id) where job_id is not null do nothing`;
        handled.push({
          processRunId: row.process_run_id,
          stageIdx: row.stage_idx,
          jobId: job.id,
          userId: p.user_id,
          kind: step.kind,
        });
        const sections: string[] = row.sections ?? [];
        await rt.agent(
          job,
          step.kind === "ask"
            ? { status: "need_input", question: step.question, choices: step.choices }
            : {
                status: "done",
                text: md(step.kind === "missing" ? sections.slice(0, -1) : sections),
              },
        );
      }
    } catch {
      // bảng/cột 0019 chưa có hoặc job đã bị nhận — vòng sau thử lại
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 100);
  return {
    sql,
    ready,
    tok,
    call: async (r, method, path, body) => api(hub as never, await tok(r), method, path, body),
    script,
    handled,
    stop: async () => {
      clearInterval(timer);
      ac.abort();
      await server.stop(true);
      redis.disconnect();
      rtRedis.disconnect();
      await db.close();
      await sql.end();
    },
  };
}

/** `hub:seed` thật (mẫu `sdlc`, `hoa-don`, agent/nhóm vai) + bật mọi agent/nhóm cho acme + grant agent cho A. */
export async function seedReal(c: Scenario): Promise<void> {
  const m = await loadSeed();
  // Admin tạo workflow `ghi-so` (side_effect) TRƯỚC seed Hub — seed chỉ ĐỌC admin.workflows (HUB-FR-109 · SC-2).
  const [sec] = await c.sql<
    { id: string }[]
  >`insert into admin.secrets (name, ciphertext, iv, key_version, last4)
    values ('QW_SC_GHI_SO', ${Buffer.alloc(32, 7)}, ${Buffer.alloc(12, 3)}, 1, 'abcd')
    on conflict (name) do update set last4 = excluded.last4 returning id`;
  await c.sql`insert into admin.workflows (key, name, description, app_type, base_url, secret_id, input_schema,
      output_field, enabled, side_effect)
    values ('ghi-so', 'WFNAME-ghi-so-qc', 'Ghi sổ kế toán (thử P-a).', 'workflow', 'http://127.0.0.1:9', ${sec?.id ?? ""},
      ${c.sql.json([{ name: "title", type: "text", required: true, description: "Biến title" }])}, null, true, true)
    on conflict (key) do update set side_effect = true`;
  await fn(
    m,
    "runHubSeed",
  )({ url: OWNER_URL, dir: m.DEFAULT_SEED_DIR, appEnv: "development", fixtures: true });
  await c.sql`insert into hub.agent_entitlements (agent_id, tenant_id)
    select id, ${T.acme}::uuid from hub.agents on conflict do nothing`;
  await c.sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
    select id, ${T.acme}::uuid, 'user', ${PA.A.id}::uuid from hub.agents on conflict do nothing`;
  await c.sql`insert into hub.agent_team_entitlements (team_id, tenant_id)
    select id, ${T.acme}::uuid from hub.agent_teams on conflict do nothing`;
  await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
}

/** Chép mẫu `key` sang acme (Group kiểm theo thứ tự stage review), bật; trả id def. */
export async function copyTemplate(c: Scenario, key: string, groups: string[]): Promise<string> {
  const [t] = await c.sql<
    Json[]
  >`select * from hub.process_defs where tenant_id is null and key = ${key}
    and deleted_at is null`;
  if (!t) throw new Error(`mẫu ${key} chưa seed`);
  let i = 0;
  const stages = (t.stages as Json[]).map((s) =>
    s.after?.kind === "review" ? { ...s, after: { ...s.after, group_id: groups[i++] ?? null } } : s,
  );
  await c.sql`update hub.process_defs set deleted_at = now() where tenant_id = ${T.acme} and key = ${key}
    and deleted_at is null`;
  const [d] = await c.sql<
    { id: string }[]
  >`insert into hub.process_defs (tenant_id, key, name, description, input_hint,
      run_group_ids, stages, token_budget, enabled, source_template_id, version)
    values (${T.acme}, ${key}, ${t.name}, ${t.description}, ${t.input_hint}, '{}'::uuid[], ${c.sql.json(stages)}, null,
      true, ${t.id}, 1) returning id`;
  await c.sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
  return d?.id ?? "";
}

/** Chờ tới khi `pred` đúng (poll 100ms; hết hạn ⇒ trả giá trị cuối để `expect` báo đúng chỗ). */
export async function until<V>(
  get: () => Promise<V>,
  pred: (v: V) => boolean,
  ms = 15_000,
): Promise<V> {
  const end = Date.now() + ms;
  let v = await get();
  while (!pred(v) && Date.now() < end) {
    await Bun.sleep(100);
    v = await get();
  }
  return v;
}

/** Task mở (kind) của run; `null` nếu chưa có. */
export async function openTask(
  c: Scenario,
  runId: string,
  kind: "review" | "ask" | "decision",
): Promise<Json | null> {
  const [t] = await c.sql<Json[]>`select id, stage_run_id, kind from hub.review_tasks
    where process_run_id = ${runId} and kind = ${kind} and status = 'open' order by created_at desc limit 1`;
  return t ?? null;
}
export const waitTask = (
  c: Scenario,
  runId: string,
  kind: "review" | "ask" | "decision",
  ms = 20_000,
) =>
  until(
    () => openTask(c, runId, kind),
    (t) => t !== null,
    ms,
  );
export const runRow = async (c: Scenario, runId: string): Promise<Json> =>
  (await c.sql<Json[]>`select * from hub.process_runs where id = ${runId}`)[0];

export { PA, PA_FIX, T };
