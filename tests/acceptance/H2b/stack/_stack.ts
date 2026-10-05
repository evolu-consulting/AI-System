// WRK-FR-03, WRK-FR-15, HUB-FR-91, HUB-FR-95 · hạ tầng test nhóm S H2b (test-plan-py §3 S01–S08, test-plan §2 "Stack"):
// hub-api THẬT trên host + agent-runtime THẬT trong container (`fake-cli`) + mock Dify MK trong tiến trình + Postgres/Redis
// compose. Dùng lại khởi động của H2a `stack/_stack.ts` (khoá, không sửa): `startHubProcH2a` (env H2a; truyền
// `process.env` ⇒ `HUB_MAX_CONCURRENT_RUNS` của `test:h2b:stack` = 2, đặt lại tường minh ở đây — L6),
// `startRuntimeH2a` (container `--add-host host.docker.internal`, TC-4). Fixture = H1 + catalog/agent H2a + agent H2b
// (`insertH2bAgents`), `runLive` của `lan` kết thúc (limit 2). Không chứa `it(...)`.
// Chạy riêng: `bun run test:h2b:stack` (`bunfig.stack.toml`; không song song test:int TS/Python cùng DB).
import { expect } from "bun:test";
import {
  call,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  sign,
  USERS,
  type UserKey,
  waitFor,
} from "../../H1/_fixtures";
import { insertConv, insertHubConfig, runIdOf, type Sse, send } from "../../H1/_hub";
import { type Dify, insertCatalog, insertH2aAgents, startDify } from "../../H2a/_h2a";
import { endSqlRun } from "../../H2a/_h2a2";
import {
  HOST_ALIAS,
  type HubProc,
  type RuntimeBox,
  startHubProcH2a,
  startRuntimeH2a,
} from "../../H2a/stack/_stack";
import { insertH2bAgents } from "../_h2b";

/** L6: stack H2b dùng ngưỡng 2 tường minh (không thừa hưởng 20 của hub-dev). */
export const STACK_MAX_RUNS = "2";

export type StackH2b = {
  sql: Sql;
  k: Keys;
  hub: HubProc;
  dify: Dify;
  rt: RuntimeBox;
  token: (who: UserKey) => Promise<string>;
  stop: () => Promise<void>;
};

/** DB sạch + fixture H1/H2a/H2b + hub-api (host) + Runtime `fake-cli` (container `rtName`). */
export async function bootStackH2b(
  rtName: string,
  rtEnv: Record<string, string> = {},
): Promise<StackH2b> {
  process.env.HUB_MAX_CONCURRENT_RUNS = STACK_MAX_RUNS;
  await prepareDb();
  const sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  const dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl, extras: true });
  await sql`update admin.workflows set base_url = ${dify.baseUrl.replace("localhost", HOST_ALIAS)}
    where id in (select workflow_id from admin.commands where mode = 'async')`;
  await insertH2aAgents(sql);
  await insertH2bAgents(sql);
  await endSqlRun(sql, R.runLive);
  const k = await makeKeys();
  const hub = await startHubProcH2a(k);
  const rt = await startRuntimeH2a(rtName, `${rtName}-1`, {
    providers: "fake-cli",
    hubUrl: hub.publicUrl,
    env: rtEnv,
  });
  return {
    sql,
    k,
    hub,
    dify,
    rt,
    token: (who) => sign(k, USERS[who]),
    stop: async () => {
      rt.stop();
      await hub.stop();
      await dify.close();
      await sql.end();
    },
  };
}

export type StackRun = { s: Sse; runId: string; conv: string; flowId: string };

/** E12 của `who` vào hội thoại mới (hoặc `conv`/`flowId` cũ); 200 SSE bắt buộc. */
export async function stackRun(
  st: StackH2b,
  content: string,
  o: { who?: UserKey; conv?: string; flowId?: string } = {},
): Promise<StackRun> {
  const who = o.who ?? "lan";
  const conv = o.conv ?? (await insertConv(st.sql, who, crypto.randomUUID()));
  const s = await send(st.hub, await st.token(who), conv, content, o.flowId);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s), conv, flowId: s.headers.get("x-flow-id") ?? "" };
}

/** Chờ sự kiện kết thúc (Runtime thật: rộng 60 s), đóng SSE, kiểm tên sự kiện. */
export async function endOf(x: StackRun, event = "run.finished", ms = 60_000): Promise<Json> {
  const end = await x.s.terminal(ms);
  x.s.close();
  expect(end?.event).toBe(event);
  return end?.data;
}

/** Nội dung tin `assistant` (E11) của flow. */
export async function assistantContent(st: StackH2b, x: StackRun): Promise<string | undefined> {
  const res = await call(st.hub, "GET", `/conversations/${x.conv}/messages?flow_id=${x.flowId}`, {
    token: await st.token("lan"),
  });
  expect(res.status).toBe(200);
  return (res.json?.items ?? []).find((m: Json) => m.role === "assistant")?.content;
}

/** `afterEach`: huỷ (E15) run `running` còn lại; sót sau 5 s → kết thúc bằng SQL (giữ ngưỡng 2 cho ca sau). */
export async function settleStack(st: StackH2b): Promise<void> {
  const rows = await st.sql<{ id: string; user_id: string }[]>`
    select id, user_id from hub.runs where status = 'running'`;
  for (const r of rows) {
    const who = (Object.keys(USERS) as UserKey[]).find((u) => USERS[u].id === r.user_id);
    if (who) await call(st.hub, "POST", `/runs/${r.id}/cancel`, { token: await st.token(who) });
  }
  const ids = rows.map((r) => r.id);
  const left = await waitFor(
    () =>
      st.sql<{ id: string }[]>`select id from hub.runs
        where id = any(${st.sql.array(ids, 2950)}) and status = 'running'`,
    (rs) => rs.length === 0,
    5_000,
  );
  for (const r of left) await endSqlRun(st.sql, r.id);
}

/** `result` của job agent `key` trong run (JobOutput `agent_result`). */
export async function agentResultOf(st: StackH2b, runId: string, key: string): Promise<Json> {
  const [row] = await st.sql<{ result: Json }[]>`select result from hub.jobs
    where run_id = ${runId} and payload->'agent'->>'key' = ${key} order by created_at desc limit 1`;
  return row?.result?.result ?? null;
}
