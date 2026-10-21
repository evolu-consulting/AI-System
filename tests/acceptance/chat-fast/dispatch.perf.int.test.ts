// HUB-FR-77 · Luật 4c · chat-fast: chi phí Hub mỗi tin (Runtime kịch bản trả ngay, không CLI/model) — đường Orchestrator (2 job:
// Orchestrator delegate → agent) so với định tuyến nhanh (1 job agent). Đo E12 → job đầu `queued` (dispatch) và E12 → `run.finished`.
// Ngưỡng: fast p95 tổng ≤ 400 ms và nhỏ hơn p95 đường Orchestrator (bỏ hẳn một job). Số in ra để ghi docs/specs/chat-fast/tasks.md.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
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
import { type H2bExtra, menuKeys, settleRuns, setupH2b, startHubH2b } from "../H2b/_h2b";
import { quantile } from "../H2b/_stream";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
const N = 20;

beforeAll(async () => {
  sql = await setupH2b();
  k = await makeKeys();
  const extra = { fastRoute: true, maxConcurrentRuns: 20 } as H2bExtra;
  hub = await startHubH2b(k, extra);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
  await hubConfigChange(
    sql,
    (tx) => tx`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
      values (${AG.assistant}, ${T.acme}, 'user', ${USERS.tadmin.id})`,
  );
  const token = await sign(k, USERS.tadmin);
  await waitFor(
    () => menuKeys(hub, token),
    (keys) => keys?.join() === "assistant",
    5_000,
  );
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

type Sample = { dispatch: number; total: number };

/** Một tin: E12 → job đầu (dispatch) → Runtime trả ngay từng job → `run.finished` (total). */
async function once(who: UserKey, content: string, orchestrated: boolean): Promise<Sample> {
  const conv = await insertConv(sql, who, crypto.randomUUID());
  const token = await sign(k, USERS[who]);
  const t0 = performance.now();
  const s = await send(hub, token, conv, content);
  const runId = runIdOf(s);
  const first = await rt.next(runId);
  const dispatch = performance.now() - t0;
  if (orchestrated) {
    expect(first.payload.agent.role).toBe("orchestrator");
    await rt.decide(first, { decision: "delegate", agent: "assistant", task: content });
    await rt.agent(await rt.next(runId), { status: "done", text: "Xong." });
  } else {
    expect(first.payload.agent.role).toBe("agent");
    await rt.agent(first, { status: "done", text: "Xong." });
  }
  const end = await s.terminal(10_000);
  const total = performance.now() - t0;
  s.close();
  expect(end?.event).toBe("run.finished");
  return { dispatch, total };
}

const p = (xs: number[], q: number) => Math.round(quantile(xs, q));
const stats = (xs: Sample[]) => ({
  dispatch_p50: p(
    xs.map((x) => x.dispatch),
    0.5,
  ),
  dispatch_p95: p(
    xs.map((x) => x.dispatch),
    0.95,
  ),
  total_p50: p(
    xs.map((x) => x.total),
    0.5,
  ),
  total_p95: p(
    xs.map((x) => x.total),
    0.95,
  ),
});

describe("chat-fast · chi phí Hub mỗi tin [Luật 4c]", () => {
  it("HUB-FR-77 · fast (1 job) p95 tổng ≤ 400 ms và < đường Orchestrator (2 job)", async () => {
    await once("tadmin", "khởi động", false); // làm nóng kết nối/cache
    await once("hoa", "khởi động", true);
    const orch: Sample[] = [];
    const fast: Sample[] = [];
    for (let i = 0; i < N; i++) {
      orch.push(await once("hoa", `Đo orch ${i}`, true));
      fast.push(await once("tadmin", `Đo fast ${i}`, false));
    }
    await settleRuns(hub, sql, k);
    const o = stats(orch);
    const f = stats(fast);
    console.log(
      `chat-fast perf (ms, N=${N}) orchestrated=${JSON.stringify(o)} fast=${JSON.stringify(f)}`,
    );
    expect(f.total_p95).toBeLessThanOrEqual(400);
    expect(f.total_p95).toBeLessThan(o.total_p95);
  }, 120_000);
});
