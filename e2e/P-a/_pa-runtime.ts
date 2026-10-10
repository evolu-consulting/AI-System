// HUB-FR-105…110 · e2e P-a · Runtime GIẢ trong tiến trình stack (bun; mẫu `e2e/chat/_x2b-runtime.ts`): vòng lặp claim
// `hub.jobs` của stage quy trình (`runs.process_run_id` not null, plan D1/N4) rồi XADD `run:<id>` (job.started → job.result)
// + ghi `usage_logs` (`step_id` từ payload, model `fake-1`) như Runtime thật. Kịch bản theo (`process_key` | `process_run_id`,
// `stage_idx`): `done` (md đủ mục) · `missing` (md thiếu mục cuối) · `ask` (need_input) · `fail` (job failed) · `hold` (để
// queued tới khi đổi kịch bản). Không có kịch bản ⇒ `done`. Test gọi `POST /rt/script|reset`, `GET /rt/log`.
// Bảng 0019 vắng (trước B1) ⇒ truy vấn lỗi ⇒ bỏ qua (stack vẫn lên — test-plan §5 e2e).
import {
  type AgentResult,
  RUN_STREAM_FIELD,
  RunEventSchema,
  runStreamKey,
} from "@ai/contracts/hub";
import type postgres from "postgres";
import type { Redis } from "../../apps/hub-api/src/lib/redis";
import { fullMd } from "./_pa-data";

export type Step =
  | { kind: "done"; tag?: string }
  | { kind: "missing" }
  | { kind: "ask"; question: string; choices: string[] }
  | { kind: "fail" }
  | { kind: "hold" };
type Payload = {
  tenant_id: string;
  run_id: string;
  step_id: string;
  user_id: string;
  agent: { id: string };
  provider_key?: string;
};
type Row = {
  id: string;
  run_id: string;
  payload: Payload;
  process_run_id: string;
  stage_idx: number;
  key: string;
  sections: string[] | null;
};
export type Handled = {
  process_run_id: string;
  stage_idx: number;
  step: Step["kind"];
  user_id: string;
};

export class PaRuntime {
  private readonly scripts = new Map<string, Step[]>();
  readonly log: Handled[] = [];
  private busy = false;
  constructor(
    private readonly sql: postgres.Sql,
    private readonly redis: Redis,
  ) {}

  setScript(target: string, stageIdx: number, steps: Step[]): void {
    this.scripts.set(`${target}:${stageIdx}`, [...steps]);
  }
  reset(): void {
    this.scripts.clear();
    this.log.length = 0;
  }

  private next(r: Row): Step | null {
    for (const k of [`${r.process_run_id}:${r.stage_idx}`, `${r.key}:${r.stage_idx}`]) {
      const q = this.scripts.get(k);
      if (q?.length) {
        const s = q[0] as Step;
        if (s.kind === "hold") return null;
        q.shift();
        return s;
      }
    }
    return { kind: "done" };
  }

  private async emit(runId: string, jobId: string, seq: number, body: Record<string, unknown>) {
    const ev = RunEventSchema.parse({
      v: 1,
      job_id: jobId,
      seq,
      at: new Date().toISOString(),
      ...body,
    });
    await this.redis.xadd(
      runStreamKey(runId),
      "MAXLEN",
      "~",
      "10000",
      "*",
      RUN_STREAM_FIELD,
      JSON.stringify(ev),
    );
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const rows = await this.sql<Row[]>`
        select j.id, j.run_id, j.payload, r.process_run_id, sr.stage_idx, pr.snapshot->>'key' as key,
          (select array_agg(x) from jsonb_array_elements_text(
            pr.snapshot->'stages'->(sr.stage_idx::int)->'output'->'required_sections') x) as sections
        from hub.jobs j
        join hub.runs r on r.id = j.run_id
        join hub.stage_runs sr on sr.id = r.stage_run_id
        join hub.process_runs pr on pr.id = r.process_run_id
        where j.status = 'queued' and r.process_run_id is not null
        order by j.created_at, j.id limit 10`;
      for (const r of rows) await this.handle(r);
    } catch {
      // bảng/cột 0019 chưa có (trước B1) — bỏ qua
    } finally {
      this.busy = false;
    }
  }

  private async handle(r: Row): Promise<void> {
    const step = this.next(r);
    if (!step) return;
    const up = await this
      .sql`update hub.jobs set status = 'running', worker_id = 'e2e-pa-rt', started_at = now(),
        heartbeat_at = now(), attempts = attempts + 1 where id = ${r.id} and status = 'queued' returning id`;
    if (!up.length) return;
    const provider = r.payload.provider_key ?? "fake-cli";
    await this.emit(r.run_id, r.id, 1, {
      type: "job.started",
      worker_id: "e2e-pa-rt",
      provider_key: provider,
    });
    this.log.push({
      process_run_id: r.process_run_id,
      stage_idx: r.stage_idx,
      step: step.kind,
      user_id: r.payload.user_id,
    });
    const sections = r.sections ?? [];
    if (step.kind === "fail") {
      await this
        .sql`update hub.jobs set status = 'failed', finished_at = now(), pgid = null where id = ${r.id}`;
      await this.emit(r.run_id, r.id, 2, {
        type: "job.failed",
        status: "failed",
        code: "UPSTREAM_ERROR",
        reason: null,
        message: "e2e fail",
        usage: { input_tokens: 0, output_tokens: 0 },
      });
      return;
    }
    const result: AgentResult =
      step.kind === "ask"
        ? { status: "need_input", question: step.question, choices: step.choices }
        : {
            status: "done",
            text:
              fullMd(
                step.kind === "missing" ? sections.slice(0, -1) : sections,
                step.kind === "done" ? step.tag : "",
              ) || "## Kết quả\nxong.\n",
          };
    const output = { kind: "agent_result", result };
    await this
      .sql`update hub.jobs set status = 'succeeded', result = ${this.sql.json(output)}, finished_at = now(),
      pgid = null where id = ${r.id} and status = 'running'`;
    const p = r.payload;
    await this
      .sql`insert into hub.usage_logs (tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key,
        model, billing, input_tokens, output_tokens, cost_usd, overage, latency_ms, job_id)
      values (${p.tenant_id}, ${p.run_id}, ${p.step_id ?? null}, ${p.user_id}, null, ${p.agent?.id ?? null}, ${provider},
        'fake-1', 'subscription', 100, 20, 0, false, 10, ${r.id})
      on conflict (job_id) where job_id is not null do nothing`;
    await this.emit(r.run_id, r.id, 2, {
      type: "job.result",
      output,
      usage: { input_tokens: 100, output_tokens: 20 },
      session_resumed: false,
    });
  }
}

/** HTTP `/rt/<op>`: `script {process_key|process_run_id, stage_idx, steps}` · `reset` · `log`. */
export async function handleRt(rt: PaRuntime, req: Request): Promise<Response> {
  const op = new URL(req.url).pathname.replace(/^\/rt\//, "");
  if (op === "log") return Response.json(rt.log);
  if (op === "reset") {
    rt.reset();
    return Response.json({ ok: true });
  }
  if (op === "script") {
    const b = (await req.json()) as {
      process_key?: string;
      process_run_id?: string;
      stage_idx: number;
      steps: Step[];
    };
    const target = b.process_run_id ?? b.process_key;
    if (!target) return new Response("thiếu process_key/process_run_id", { status: 400 });
    rt.setScript(target, b.stage_idx, b.steps);
    return Response.json({ ok: true });
  }
  return new Response("bad op", { status: 400 });
}
