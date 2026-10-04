// HUB-FR-13 (async) · WRK-FR-07 · AC-W06 (phần Hub) · H2a-R12, R13 · Q6 · P9, P10, P13 · test-plan H2a §5 A30–A39:
// command `mode=async` → job `workflow.async` (provider `dify`, không secret trong payload), SSE như sync, `job.progress`
// không lọt SSE, ánh xạ `job.failed`, provider tắt, hạn run giữ qua requeue, hết hạn `queued` tính từ `queued_at`, huỷ,
// quét orphan Hub requeue job async (không XADD) / vẫn `failed orphaned` khi side_effect đã gửi, attempts=3, huỷ, agent.cli.
// Runtime = `ScriptRuntime2` (claim bằng SQL owner kèm token, Q-T8).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { CHAT_EVENT_NAMES } from "@ai/contracts/chat";
import { WorkflowAsyncJobSchema } from "@ai/contracts/hub";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  call,
  insertFixture,
  type Json,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  USERS,
  waitFor,
} from "../H1/_fixtures";
import {
  AG,
  deltaText,
  type HubX,
  hubConfigChange,
  insertConv,
  insertHubConfig,
  runIdOf,
  type Sse,
  send,
  testRedis,
} from "../H1/_hub";
import { type Dify, idGen2, insertCatalog, startDify, startHubH2a, WF } from "./_h2a";
import { addCommand } from "./_h2a2";
import { insertSqlJob, ScriptRuntime2 } from "./_runtime2";

let sql: Sql;
let listener: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt2: ScriptRuntime2;
let dify: Dify;
const id = idGen2(5000);
const CMD_ASYNC3 = "a2a00000-0000-4000-8000-000000000091";
const notes: { ch: string; p: Json }[] = [];

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl, extras: true });
  await addCommand(sql, { id: CMD_ASYNC3, name: "dich-async3", mode: "async", timeoutS: 3 });
  listener = ownerSql();
  for (const ch of ["job_enqueued", "job_cancel"])
    await listener.listen(ch, (raw) => {
      try {
        notes.push({ ch, p: JSON.parse(raw) });
      } catch {
        notes.push({ ch, p: raw });
      }
    });
  k = await makeKeys();
  hub = await startHubH2a(k);
  redis = await testRedis();
  rt2 = new ScriptRuntime2(sql, redis);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await listener?.end();
  await sql?.end();
});

async function open(content: string): Promise<Sse> {
  const conv = await insertConv(sql, "lan", id());
  return send(hub, await sign(k, USERS.lan), conv, content);
}
const jobRow = async (jobId: string): Promise<Json> =>
  (await sql`select * from hub.jobs where id = ${jobId}`)[0];
const runEvents = async (runId: string): Promise<Json[]> =>
  (await redis.xrange(`run:${runId}`, "-", "+")).map(([, f]) =>
    JSON.parse(f[f.indexOf("e") + 1] ?? "null"),
  );

describe("A30–A36 · command async qua job workflow.async [HUB-FR-13 · WRK-FR-07 · H2a-R12]", () => {
  it("HUB-FR-13 · A30 · /dich-async → 1 job workflow.async (dify, agent_id NULL), payload WorkflowAsyncJob không secret/URL/token, dify_user, side_effect=false, timeout_s=commands.timeout_s; SSE như sync [HUB-FR-13]", async () => {
    const s = await open("/dich-async en xin chào");
    try {
      expect(s.status).toBe(200);
      const runId = runIdOf(s);
      const a = await rt2.claimAsync(runId);
      const jobs = await sql<Json[]>`select type, provider_key, agent_id, payload from hub.jobs
        where run_id = ${runId}`;
      expect(jobs.length).toBe(1);
      expect(jobs[0]).toMatchObject({
        type: "workflow.async",
        provider_key: "dify",
        agent_id: null,
      });
      const p = WorkflowAsyncJobSchema.safeParse(jobs[0]?.payload);
      expect(p.success).toBe(true);
      expect(p.data).toMatchObject({
        workflow_id: WF.dich,
        workflow_key: "dich",
        app_type: "workflow",
        inputs: { source_text: "xin chào", target_lang: "en", tone: "neutral" },
        query: null,
        dify_user: `acme:${USERS.lan.id}`,
        side_effect: false,
        timeout_s: 30,
        run_id: runId,
      });
      const raw = JSON.stringify(jobs[0]?.payload);
      for (const bad of [
        "api_key",
        "base_url",
        '"token"',
        "job_token",
        "mk-",
        "LEAK_KEY_",
        dify.baseUrl,
      ])
        expect({ bad, hit: raw.includes(bad) }).toEqual({ bad, hit: false });
      await rt2.rt.text(a.job, "Kết quả dịch async.");
      const end = await s.terminal(8_000);
      expect(end?.event).toBe("run.finished");
      expect(end?.data?.content).toBe("Kết quả dịch async.");
      expect(deltaText(s.events)).toBe("Kết quả dịch async.");
      expect(dify.runs().length).toBe(0);
    } finally {
      s.close();
    }
  });

  it("HUB-FR-13 · A31 · job.progress ×3 → không lọt SSE; đúng 1 cặp step.started/finished; job.result → delta ≤ 40 + run.finished [H2a-R12 · P13]", async () => {
    const s = await open("/dich-async en xin");
    try {
      const a = await rt2.claimAsync(runIdOf(s));
      for (let i = 0; i < 3; i++) await rt2.rt.progress(a.job, "Đang chạy lệnh");
      const long = "Câu trả lời dài hơn bốn mươi ký tự để Hub phải cắt thành nhiều delta nhỏ.";
      await rt2.rt.text(a.job, long);
      const end = await s.terminal(8_000);
      expect(end?.event).toBe("run.finished");
      const names = s.events.map((e) => e.event);
      for (const n of names) expect(CHAT_EVENT_NAMES as readonly string[]).toContain(n);
      expect(names).not.toContain("job.progress");
      expect(names.filter((n) => n === "step.started").length).toBe(1);
      expect(names.filter((n) => n === "step.finished").length).toBe(1);
      const deltas = s.events.filter((e) => e.event === "delta");
      expect(deltas.length).toBeGreaterThanOrEqual(2);
      for (const d of deltas) expect(String(d.data?.text ?? "").length).toBeLessThanOrEqual(40);
      expect(deltaText(s.events)).toBe(long);
      const [st] = await sql<
        Json[]
      >`select type, workflow_id from hub.run_steps where run_id = ${runIdOf(s)}`;
      expect(st).toEqual({ type: "workflow", workflow_id: WF.dich });
    } finally {
      s.close();
    }
  });

  // Vế NOT_CONFIGURED cần CHECK `jobs_error_code_check` nhận `NOT_CONFIGURED` + `jobs_error_reason_check` nhận
  // `credential`/`upstream` (migration 0004, test-plan §10 QW-A1 "D1 thiếu CHECK") — ScriptRuntime ghi DB như Runtime.
  for (const [code, reason] of [
    ["UPSTREAM_ERROR", "upstream"],
    ["NOT_CONFIGURED", "credential"],
  ] as const) {
    it(`HUB-FR-13 · A32 · job.failed{${code}/${reason}} → run.failed ${code} [H2a-R12 · H2a-R11]`, async () => {
      const s = await open("/dich-async en xin");
      try {
        const a = await rt2.claimAsync(runIdOf(s));
        await rt2.rt.fail(a.job, code, "dify lỗi", reason);
        const end = await s.terminal(8_000);
        expect(end?.event).toBe("run.failed");
        expect(end?.data?.code).toBe(code);
      } finally {
        s.close();
      }
    });
  }

  it("HUB-FR-13 · A33 · provider dify enabled=false → run.failed NOT_CONFIGURED, 0 job [H2a-R12 · P9]", async () => {
    await hubConfigChange(
      sql,
      (tx) => tx`update hub.providers set enabled = false where key = 'dify'`,
    );
    try {
      await Bun.sleep(500);
      const s = await open("/dich-async en xin");
      try {
        expect(s.status).toBe(200);
        const end = await s.terminal(8_000);
        expect(end?.event).toBe("run.failed");
        expect(end?.data?.code).toBe("NOT_CONFIGURED");
        const [n] = await sql<{ n: number }[]>`select count(*)::int as n from hub.jobs
          where run_id = ${runIdOf(s)}`;
        expect(n?.n).toBe(0);
      } finally {
        s.close();
      }
    } finally {
      await hubConfigChange(
        sql,
        (tx) => tx`update hub.providers set enabled = true where key = 'dify'`,
      );
    }
  });

  it("WRK-FR-06 · A34 · timeout_s=3 giữ qua requeue: claim → requeue (SQL) → claim lại (job.started lặp) → không kết quả → ≤ 3 s + biên run.failed TIMEOUT, cancel_requested_at + NOTIFY job_cancel [H2a-R13 · P10]", async () => {
    const t0 = Date.now();
    const s = await open("/dich-async3 en xin");
    try {
      const runId = runIdOf(s);
      const a1 = await rt2.claimAsync(runId);
      await sql`update hub.jobs set status = 'queued', worker_id = null, heartbeat_at = null, started_at = null,
        token_hash = null, queued_at = now() where id = ${a1.job.id}`;
      await sql.notify(
        "job_enqueued",
        JSON.stringify({ v: 1, job_id: a1.job.id, provider_key: "dify" }),
      );
      const a2 = await rt2.claimAsync(runId);
      expect(a2.job.id).toBe(a1.job.id);
      const end = await s.terminal(8_000);
      const ms = Date.now() - t0;
      expect(end?.event).toBe("run.failed");
      expect(end?.data?.code).toBe("TIMEOUT");
      expect(ms).toBeLessThanOrEqual(3_000 + 2_500);
      const names = s.events.map((e) => e.event);
      expect(names.filter((n) => n === "step.started").length).toBe(1);
      expect(names.filter(isTerminalName).length).toBe(1);
      expect((await jobRow(a1.job.id))?.cancel_requested_at).not.toBeNull();
      const got = await waitFor(
        async () => notes.filter((x) => x.ch === "job_cancel" && x.p?.job_id === a1.job.id),
        (v) => v.length > 0,
        3_000,
      );
      expect(got.length).toBeGreaterThan(0);
    } finally {
      s.close();
    }
  });

  it("HUB-FR-13 · A35 · hết hạn queued tính từ queued_at: created_at cũ 1 giờ + requeue ở ~3 s → ở ~6.5 s job vẫn queued, run chưa kết thúc [H2a-R12 · P10]", async () => {
    const t0 = Date.now();
    const s = await open("/dich-async en xin");
    try {
      const runId = runIdOf(s);
      const a = await rt2.claimAsync(runId);
      await Bun.sleep(Math.max(0, 3_000 - (Date.now() - t0)));
      await sql`update hub.jobs set status = 'queued', worker_id = null, heartbeat_at = null, started_at = null,
        token_hash = null, queued_at = now(), created_at = now() - interval '1 hour' where id = ${a.job.id}`;
      await Bun.sleep(Math.max(0, 6_500 - (Date.now() - t0)));
      const j = await jobRow(a.job.id);
      expect({ status: j?.status, code: j?.error_code ?? null }).toEqual({
        status: "queued",
        code: null,
      });
      expect(s.events.some(isTerminal)).toBe(false);
      const again = await rt2.claimAsync(runId);
      await rt2.rt.text(again.job, "Xong sau requeue.");
      expect((await s.terminal(8_000))?.event).toBe("run.finished");
    } finally {
      s.close();
    }
  }, 30_000);

  it("HUB-FR-13 · A36 · E15 huỷ run async → cancel_requested_at + NOTIFY job_cancel; Runtime XADD job.failed CANCELLED → run.failed CANCELLED ≤ 5 s [HUB-FR-43 · H2a-R12]", async () => {
    const s = await open("/dich-async en xin");
    try {
      const runId = runIdOf(s);
      const a = await rt2.claimAsync(runId);
      const t0 = Date.now();
      const res = await call(hub, "POST", `/runs/${runId}/cancel`, {
        token: await sign(k, USERS.lan),
      });
      expect(res.status).toBe(200);
      const row = await waitFor(
        () => jobRow(a.job.id),
        (j) => j?.cancel_requested_at != null,
        3_000,
      );
      expect(row?.cancel_requested_at).not.toBeNull();
      const n = await waitFor(
        async () => notes.filter((x) => x.ch === "job_cancel" && x.p?.job_id === a.job.id),
        (v) => v.length > 0,
        3_000,
      );
      expect(n.length).toBeGreaterThan(0);
      await rt2.rt.fail(a.job, "CANCELLED", "đã huỷ", "cancelled", "cancelled");
      const end = await s.terminal(5_000);
      expect(end?.event).toBe("run.failed");
      expect(end?.data?.code).toBe("CANCELLED");
      expect(Date.now() - t0).toBeLessThanOrEqual(5_000);
    } finally {
      s.close();
    }
  });
});

const TERMINAL = ["run.finished", "run.failed"];
const isTerminalName = (n: string) => TERMINAL.includes(n);
const isTerminal = (e: { event: string }) => isTerminalName(e.event);

describe("A37–A39 · quét orphan phía Hub (mỗi 10 s, ngưỡng 60 s) [AC-W06 · Q6 · H2a-R13]", () => {
  type Case = { name: string; jobId: string; runId: string };
  const cases: Record<string, Case> = {};
  const t0 = new Date();

  /** Job `running` mồ côi (heartbeat −61 s) dựng bằng SQL; `patch` chỉnh cột/payload trước khi quét. */
  async function orphan(
    name: string,
    type: "workflow.async" | "agent.cli",
    patch: string,
  ): Promise<void> {
    const j =
      type === "workflow.async"
        ? await insertSqlJob(sql, id, { type, workflowId: WF.dich, workflowKey: "dich" })
        : await insertSqlJob(sql, id, { type, agentId: AG.hoadon, agentKey: "hoadon" });
    await sql.unsafe(
      `update hub.jobs set heartbeat_at = now() - interval '61 seconds', dispatched_at = now() - interval '62 seconds'
       ${patch} where id = $1`,
      [j.jobId],
    );
    cases[name] = { name, jobId: j.jobId, runId: j.runId };
  }

  beforeAll(async () => {
    await orphan("A37", "workflow.async", "");
    await orphan(
      "A38-side",
      "workflow.async",
      `, payload = jsonb_set(payload, '{side_effect}', 'true')`,
    );
    await orphan("A38-att3", "workflow.async", ", attempts = 3");
    await orphan("A38-cancel", "workflow.async", ", cancel_requested_at = now()");
    await orphan("A39", "agent.cli", "");
    // một lượt quét đã chạy khi job agent.cli (H1) bị đánh dấu — cả hai câu (requeue rồi failed) cùng lượt
    const done = await waitFor(
      () => jobRow(cases.A39?.jobId ?? ""),
      (j) => j?.status !== "running",
      25_000,
    );
    expect(done?.status).toBe("failed");
  }, 40_000);

  it("WRK-FR-06 · A37 · workflow.async running, heartbeat −61 s, attempts=1 → queued; token_hash/dispatched_at/worker_id NULL; queued_at mới; NOTIFY job_enqueued{provider_key:dify}; không XADD job.failed [AC-W06 · H2a-R13]", async () => {
    const c = cases.A37 as Case;
    const j = await jobRow(c.jobId);
    expect({
      status: j?.status,
      token: j?.token_hash,
      dispatched: j?.dispatched_at,
      worker: j?.worker_id,
      code: j?.error_code,
    }).toEqual({ status: "queued", token: null, dispatched: null, worker: null, code: null });
    expect(new Date(j?.queued_at).getTime()).toBeGreaterThanOrEqual(t0.getTime());
    expect(
      notes.some(
        (x) => x.ch === "job_enqueued" && x.p?.job_id === c.jobId && x.p?.provider_key === "dify",
      ),
    ).toBe(true);
    expect((await runEvents(c.runId)).filter((e) => e?.type === "job.failed")).toEqual([]);
  });

  for (const [name, why] of [
    ["A38-side", "side_effect ∧ dispatched_at đặt"],
    ["A38-att3", "attempts=3"],
    ["A38-cancel", "cancel_requested_at đặt"],
  ] as const) {
    it(`WRK-FR-06 · A38 · ${why} → không requeue, failed orphaned (H1) [Q6 · H2a-R13]`, async () => {
      const j = await jobRow((cases[name] as Case).jobId);
      expect({ status: j?.status, reason: j?.error_reason }).toEqual({
        status: "failed",
        reason: "orphaned",
      });
    });
  }

  it("HUB-FR-89 · A39 · job agent.cli mồ côi → vẫn failed orphaned + XADD job.failed (HUB-H1-AC-04 không đổi) [HUB-H1-AC-04]", async () => {
    const c = cases.A39 as Case;
    const j = await jobRow(c.jobId);
    expect({ status: j?.status, code: j?.error_code, reason: j?.error_reason }).toEqual({
      status: "failed",
      code: "INTERNAL_ERROR",
      reason: "orphaned",
    });
    const evs = await waitFor(
      () => runEvents(c.runId),
      (v) => v.some((e) => e?.type === "job.failed"),
      3_000,
    );
    expect(evs.some((e) => e?.type === "job.failed" && e?.job_id === c.jobId)).toBe(true);
  });
});
