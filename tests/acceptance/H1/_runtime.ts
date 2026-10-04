// HUB-FR-89, WRK-FR-24 · Runtime kịch bản (test-plan H1 §2): test đóng vai Agent Runtime — claim `hub.jobs` bằng SQL owner,
// parse `JobPayloadSchema`, ghi kết quả vào `hub.jobs` rồi XADD `run:<id>` theo `@ai/contracts/hub` (plan §2.3, plan-db §5.4).
// Không chứa `it(...)`. Mỗi sự kiện được `RunEventSchema.parse` trước khi XADD (dữ liệu test luôn hợp contract).
import { expect } from "bun:test";
import {
  type AgentCliJob,
  type AgentResult,
  type HubJobErrorCode,
  type JobFailReason,
  type JobOutput,
  JobPayloadSchema,
  type OrchestratorDecision,
  RUN_STREAM_FIELD,
  type RunEvent,
  RunEventSchema,
  runStreamKey,
  type TokenUsage,
} from "@ai/contracts/hub";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import type { Sql } from "./_fixtures";

export type Job = { id: string; runId: string; payload: AgentCliJob };
const USAGE: TokenUsage = { input_tokens: 100, output_tokens: 20 };

type EventBody =
  | { type: "job.started"; worker_id: string; provider_key: string }
  | { type: "job.progress"; message: string; percent: number | null }
  | { type: "job.result"; output: JobOutput; usage: TokenUsage; session_resumed: boolean }
  | {
      type: "job.failed";
      status: "failed" | "cancelled" | "timed_out";
      code: HubJobErrorCode;
      reason: JobFailReason | null;
      message: string;
      usage: TokenUsage;
    };

export class ScriptRuntime {
  private readonly seen = new Set<string>();
  private readonly seq = new Map<string, number>();

  constructor(
    private readonly sql: Sql,
    private readonly redis: Redis,
    readonly workerId = "qc-rt-1",
  ) {}

  /** Job `queued` kế của run (bỏ job đã nhận); không có trong `ms` → undefined. Không claim. */
  async peek(runId: string, ms = 5_000): Promise<{ id: string; payload: unknown } | undefined> {
    const end = Date.now() + ms;
    for (;;) {
      const seen = [...this.seen];
      const [row] = await this.sql<
        { id: string; payload: unknown }[]
      >`select id, payload from hub.jobs
        where run_id = ${runId} and status = 'queued' and not (id = any(${this.sql.array(seen, 2950)}))
        order by created_at, id limit 1`;
      if (row || Date.now() > end) return row;
      await Bun.sleep(50);
    }
  }

  /**
   * Như claim của Runtime: `queued → running` + XADD `job.started`; payload phải hợp `JobPayloadSchema`.
   * Claim có điều kiện `status = 'queued'` (SKIP job không còn queued, như Runtime thật): UPDATE 0 dòng (job vừa bị
   * huỷ/kết thúc song song) = "không có job đó" → thử job kế / chờ tới hết `ms`, không ném lỗi (phán quyết A37).
   */
  async tryNext(runId: string, ms = 5_000): Promise<Job | undefined> {
    const end = Date.now() + ms;
    for (;;) {
      const row = await this.peek(runId, Math.max(0, end - Date.now()));
      if (!row) return undefined;
      this.seen.add(row.id);
      const parsed = JobPayloadSchema.safeParse(row.payload);
      expect(parsed.success).toBe(true);
      const claimed = await this
        .sql`update hub.jobs set status = 'running', worker_id = ${this.workerId},
          started_at = now(), heartbeat_at = now(), attempts = attempts + 1
        where id = ${row.id} and status = 'queued' returning id`;
      if (claimed.length === 0) continue;
      const job: Job = { id: row.id, runId, payload: parsed.data as AgentCliJob };
      await this.emit(job, {
        type: "job.started",
        worker_id: this.workerId,
        provider_key: job.payload.provider_key,
      });
      return job;
    }
  }

  /** Như `tryNext` nhưng bắt buộc có job (Hub chưa tạo job → đỏ ở `expect`). */
  async next(runId: string, ms = 5_000): Promise<Job> {
    const job = await this.tryNext(runId, ms);
    expect(job).toBeDefined();
    return job as Job;
  }

  /** XADD một `RunEvent` (field `e`), `seq` tăng theo job. */
  async emit(job: Job, body: EventBody): Promise<void> {
    const seq = (this.seq.get(job.id) ?? 0) + 1;
    this.seq.set(job.id, seq);
    const ev: RunEvent = RunEventSchema.parse({
      v: 1,
      job_id: job.id,
      seq,
      at: new Date().toISOString(),
      ...body,
    });
    await this.redis.xadd(
      runStreamKey(job.runId),
      "MAXLEN",
      "~",
      "10000",
      "*",
      RUN_STREAM_FIELD,
      JSON.stringify(ev),
    );
  }

  async progress(job: Job, message = "đang chạy"): Promise<void> {
    await this.sql`update hub.jobs set heartbeat_at = now() where id = ${job.id}`;
    await this.emit(job, { type: "job.progress", message, percent: null });
  }

  /** Kết thúc `succeeded` (DB trước, XADD sau — plan-db §5.4). `xadd=false` → chỉ DB (A32). */
  async result(job: Job, output: JobOutput, usage: TokenUsage = USAGE, xadd = true): Promise<void> {
    await this.sql`update hub.jobs set status = 'succeeded', result = ${this.sql.json(output)},
        finished_at = now(), pgid = null
      where id = ${job.id} and worker_id = ${this.workerId} and status = 'running'`;
    if (xadd) await this.emit(job, { type: "job.result", output, usage, session_resumed: false });
  }

  text(job: Job, text: string, usage?: TokenUsage): Promise<void> {
    return this.result(job, { kind: "text", text }, usage);
  }

  /** Orchestrator trả quyết định (output `text` = JSON, Hub parse). */
  decide(job: Job, d: OrchestratorDecision, usage?: TokenUsage): Promise<void> {
    return this.text(job, JSON.stringify(d), usage);
  }

  agent(job: Job, r: AgentResult, usage?: TokenUsage): Promise<void> {
    return this.result(job, { kind: "agent_result", result: r }, usage);
  }

  async fail(
    job: Job,
    code: HubJobErrorCode,
    message: string,
    reason: JobFailReason | null = null,
    status: "failed" | "cancelled" | "timed_out" = "failed",
  ): Promise<void> {
    await this
      .sql`update hub.jobs set status = ${status}, error_code = ${code}, error_reason = ${reason},
        error_message = ${message}, finished_at = now(), pgid = null
      where id = ${job.id} and worker_id = ${this.workerId} and status = 'running'`;
    await this.emit(job, { type: "job.failed", status, code, reason, message, usage: USAGE });
  }

  /**
   * Phục vụ mọi job của run tới khi run kết thúc (DB `status <> 'running'`) hoặc hết `ms`; trả số job đã nhận.
   * Dùng cho ca vòng nhiều bước (A22): `handler` quyết theo `payload.agent.role`.
   */
  async serve(runId: string, handler: (job: Job) => Promise<void>, ms = 20_000): Promise<number> {
    const end = Date.now() + ms;
    let n = 0;
    while (Date.now() < end) {
      const [r] = await this.sql<
        { status: string }[]
      >`select status from hub.runs where id = ${runId}`;
      if (r?.status !== "running") break;
      const job = await this.tryNext(runId, 300);
      if (job) {
        n++;
        await handler(job);
      }
    }
    return n;
  }
}

/** Câu Orchestrator giả cố định (test-plan §2, Q-T8): ≥ 120 ký tự. */
export const FAKE_TAIL =
  " — đây là câu trả lời cố định của Orchestrator giả dùng trong kiểm thử tự động, đủ dài để Hub phải cắt thành nhiều phần delta.";

/** Orchestrator giả như `fake-cli`: chỉ echo khối `<message>` (P45). */
export function echoAnswer(job: Job): OrchestratorDecision {
  const m = /<message>([\s\S]*?)<\/message>/.exec(job.payload.prompt);
  let msg = (m?.[1] ?? "").trim();
  try {
    const v = JSON.parse(msg);
    if (typeof v === "string") msg = v;
  } catch {
    // khối không phải JSON chuỗi: giữ nguyên
  }
  return { decision: "answer", text: `echo: ${msg}${FAKE_TAIL}` };
}
