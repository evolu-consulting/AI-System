// HUB-BR-04 · WRK-FR-15 · WRK-FR-20 · H3a-R06 (khe hở), R08, R09 · PL12 · HUB-H3a-AC-04 · test-plan-cases H3a §2.2 A10–A13:
// job lọt khe hở (Hub enqueue lúc provider `ok`, provider hỏng trước khi claim) không treo — hết `max_wait_s` ⇒ job failed
// với reason theo provider (cooldown ⇒ `quota`, logged_out ⇒ `provider_unavailable`), không chặn ⇒ `queueTimeoutReason` H1.
// Hub `jobMaxWaitS = 2`; `ScriptRuntime` không claim (chỉ `peek`).
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { adminChange, T, USERS, type UserKey } from "../H1/_fixtures";
import { AG, insertConv } from "../H1/_hub";
import { settleRuns } from "../H2b/_h2b";
import {
  endOf,
  H1_EXHAUSTED,
  type H3aCtx,
  jobsOfRun,
  type ProviderStatus,
  R08,
  resetProvider,
  setProvider,
  startH3a,
  startRun,
} from "./_h3a";

let x: H3aCtx;
beforeAll(async () => {
  x = await startH3a({ jobMaxWaitS: 2 });
}, 60_000);
afterEach(() => settleRuns(x.hub, x.sql, x.k));
afterAll(() => x?.stop());

const HOUR = 3_600_000;

/**
 * Gửi tin khi provider `ok`, chờ job `queued` (không claim), rồi đổi provider (nếu có); chờ run kết thúc.
 * Trả SSE kết thúc, ms từ lúc gửi, job của run.
 */
async function expireQueued(content: string, change?: [ProviderStatus, number | null]) {
  const t0 = Date.now();
  const r = await startRun(x, "lan", content);
  expect(await x.rt.peek(r.runId)).toBeDefined();
  try {
    if (change) await setProvider(x.sql, change[0], change[1]);
    const end = await endOf(r.s, 8_000);
    const ms = Date.now() - t0;
    console.info(`[H3a ${content}] hết hạn queued → ${end.event} ${ms} ms`);
    return { end, ms, jobs: await jobsOfRun(x.sql, r.runId) };
  } finally {
    await resetProvider(x.sql);
  }
}
const failedJob = (reason: string) => [
  {
    type: "agent.cli",
    provider_key: "fake-cli",
    status: "failed",
    error_code: "ALL_PROVIDERS_EXHAUSTED",
    error_reason: reason,
  },
];

/** Job `running` giả của `who` chiếm slot tenant (như H1 A31) — run riêng của instance khác, lease 1 giờ. */
async function insertRunningJob(who: UserKey): Promise<string> {
  const u = USERS[who];
  const conv = await insertConv(x.sql, who, crypto.randomUUID());
  const [flow, run, job] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  await x.sql`insert into hub.flows (id, tenant_id, user_id, conversation_id, title, message_count)
    values (${flow}, ${u.tid}, ${u.id}, ${conv}, 'Chiếm slot H3a', 2)`;
  await x.sql`insert into hub.runs (id, tenant_id, user_id, conversation_id, flow_id, status, config_version,
      user_message_id, answer_message_id, owner, lease_until)
    values (${run}, ${u.tid}, ${u.id}, ${conv}, ${flow}, 'running', 1, ${crypto.randomUUID()},
      ${crypto.randomUUID()}, 'qc-other-instance', now() + interval '1 hour')`;
  await x.sql`insert into hub.jobs (id, tenant_id, user_id, run_id, step_id, conversation_id, agent_id, type,
      provider_key, payload, status, worker_id, started_at, heartbeat_at)
    values (${job}, ${u.tid}, ${u.id}, ${run}, ${crypto.randomUUID()}, ${conv}, ${AG.assistant}, 'agent.cli',
      'claude-sub', ${x.sql.json({})}, 'running', 'qc-slot-worker', now(), now())`;
  return run;
}
const setTenantLimit = (n: number | null) =>
  adminChange(
    x.sql,
    "tenant",
    T.acme,
    (tx) => tx`update admin.tenants set max_concurrent_sub = ${n} where id = ${T.acme}`,
  );

describe("A10–A13 · hết hạn queued khi provider hỏng sau enqueue [H3a-R06 · PL12 · HUB-H3a-AC-04]", () => {
  it("WRK-FR-20 · A10 · enqueue lúc ok → cooldown +1 h → trong [2, 6] s job failed ALL_PROVIDERS_EXHAUSTED quota; run.failed câu R08 quota [H3a-R06 · H3a-R08 · H3a-R09 · HUB-H3a-AC-04]", async () => {
    const r = await expireQueued("Câu A10", ["cooldown", HOUR]);
    expect(r.end.event).toBe("run.failed");
    expect(r.jobs).toEqual(failedJob("quota"));
    expect({ message: r.end.data?.message, hint: r.end.data?.hint }).toEqual(R08.quota.vi);
    expect(r.ms).toBeGreaterThanOrEqual(2_000);
    expect(r.ms).toBeLessThanOrEqual(6_000);
  });

  it("WRK-FR-20 · A11 · enqueue lúc ok → logged_out → job failed provider_unavailable; câu R08 provider_unavailable [H3a-R06 · H3a-R08 · HUB-H3a-AC-04]", async () => {
    const r = await expireQueued("Câu A11", ["logged_out", null]);
    expect(r.end.event).toBe("run.failed");
    expect(r.jobs).toEqual(failedJob("provider_unavailable"));
    expect({ message: r.end.data?.message, hint: r.end.data?.hint }).toEqual(
      R08.provider_unavailable.vi,
    );
    expect(r.ms).toBeLessThanOrEqual(6_000);
  });

  it("WRK-FR-20 · A12 · provider ok, tenant đầy (max_concurrent_sub=1 + 1 job running) → tenant_slots, câu H1 [H3a-R06 · H1-R18 · R14]", async () => {
    const held = await insertRunningJob("tam");
    await setTenantLimit(1);
    try {
      const r = await expireQueued("Câu A12");
      expect(r.end.event).toBe("run.failed");
      expect(r.jobs).toEqual(failedJob("tenant_slots"));
      expect({ message: r.end.data?.message, hint: r.end.data?.hint }).toEqual(H1_EXHAUSTED.vi);
    } finally {
      await setTenantLimit(null);
      await x.sql`update hub.jobs set status = 'succeeded', finished_at = now() where run_id = ${held}`;
      await x.sql`update hub.runs set status = 'finished', finished_at = now() where id = ${held}`;
    }
  });

  it("WRK-FR-20 · A13 · cooldown tới now+1 s, đã hết hạn khi Hub xét → không quota: provider_busy (queueTimeoutReason), câu H1 [H3a-R06 · H3a-R09]", async () => {
    const r = await expireQueued("Câu A13", ["cooldown", 1_000]);
    expect(r.end.event).toBe("run.failed");
    expect(r.jobs).toEqual(failedJob("provider_busy"));
    expect({ message: r.end.data?.message, hint: r.end.data?.hint }).toEqual(H1_EXHAUSTED.vi);
  });
});
