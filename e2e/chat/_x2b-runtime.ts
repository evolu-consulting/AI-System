// HUB-FR-101 · HUB-FR-103 · e2e X2b · Runtime GIẢ chạy trong tiến trình stack (bun): claim `hub.jobs` bằng SQL owner rồi XADD
// `run:<id>` (Redis) theo `@ai/contracts/hub` — giống `tests/acceptance/H1/_runtime.ts` nhưng không phụ thuộc `bun:test`.
// Test (Playwright, node) điều khiển qua HTTP `POST /rt/<op>` ở cổng "sẵn sàng" của stack. KHÔNG Dify, KHÔNG `claude-sub`.
// X2b-2 (HUB-FR-44, test-plan X2b2 §5 E05): op `output {run_id, name, bytes}` — đặt `token_hash` cho job như Runtime (mẫu
// `tests/acceptance/H2c/_h2c2.ts` `reclaim`), `POST /internal/jobs/:id/outputs` lên Hub (`hubUrl`), id output đi kèm
// `job.result.outputs` ở `answer` kế tiếp (contract C2).
import { createHash, randomBytes } from "node:crypto";
import {
  type AgentResult,
  RUN_STREAM_FIELD,
  RunEventSchema,
  runStreamKey,
} from "@ai/contracts/hub";
import type postgres from "postgres";
import type { Redis } from "../../apps/hub-api/src/lib/redis";

type Payload = {
  tenant_id: string;
  run_id: string;
  step_id: string;
  user_id: string;
  agent: { id: string };
  provider_key?: string;
};
type Claimed = {
  id: string;
  provider: string;
  seq: number;
  payload: Payload;
  token?: string;
  outputs?: string[];
};

export class FakeRuntime {
  private readonly claimed = new Map<string, Claimed>();
  constructor(
    private readonly sql: postgres.Sql,
    private readonly redis: Redis,
    private readonly hubUrl = "",
  ) {}

  private async emit(runId: string, c: Claimed, body: Record<string, unknown>): Promise<void> {
    c.seq += 1;
    const ev = RunEventSchema.parse({
      v: 1,
      job_id: c.id,
      seq: c.seq,
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

  /** Nhận job `queued` kế của run (chờ tối đa `ms`); đã nhận rồi thì trả lại. */
  async claim(runId: string, ms = 10_000): Promise<Claimed> {
    const have = this.claimed.get(runId);
    if (have) return have;
    const end = Date.now() + ms;
    for (;;) {
      const rows = await this.sql<{ id: string; payload: Payload }[]>`
        select id, payload from hub.jobs where run_id = ${runId} and status = 'queued'
        order by created_at, id limit 1`;
      const row = rows[0];
      if (row) {
        const up = await this.sql`update hub.jobs set status = 'running', worker_id = 'e2e-rt',
          started_at = now(), heartbeat_at = now(), attempts = attempts + 1
          where id = ${row.id} and status = 'queued' returning id`;
        if (up.length) {
          const c: Claimed = {
            id: row.id,
            provider: row.payload.provider_key ?? "fake-cli",
            seq: 0,
            payload: row.payload,
          };
          this.claimed.set(runId, c);
          await this.emit(runId, c, {
            type: "job.started",
            worker_id: "e2e-rt",
            provider_key: c.provider,
          });
          return c;
        }
      }
      if (Date.now() > end) throw new Error(`không có job queued cho run ${runId}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** Agent ghi `out/<name>` (X2b-2): token job + `POST /internal/jobs/:id/outputs`; id giữ tới `answer`. */
  async output(runId: string, name: string, bytes: string): Promise<string> {
    const c = await this.claim(runId);
    if (!c.token) {
      c.token = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(c.token, "ascii").digest();
      await this.sql`update hub.jobs set token_hash = ${hash} where id = ${c.id}`;
    }
    const res = await fetch(`${this.hubUrl}/internal/jobs/${c.id}/outputs`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${c.token}`,
        "content-type": "application/octet-stream",
        "X-Filename": encodeURIComponent(name),
      },
      body: new TextEncoder().encode(bytes),
    });
    const text = await res.text();
    if (res.status !== 201) throw new Error(`outputs ${res.status}: ${text.slice(0, 200)}`);
    const id = (JSON.parse(text) as { id: string }).id;
    c.outputs = [...(c.outputs ?? []), id];
    return id;
  }

  /** Kết thúc job bằng `agent_result` (done / need_input / ...). */
  async answer(runId: string, result: AgentResult): Promise<void> {
    const c = await this.claim(runId);
    const output = { kind: "agent_result", result };
    await this.sql`update hub.jobs set status = 'succeeded', result = ${this.sql.json(output)},
      finished_at = now(), pgid = null where id = ${c.id} and worker_id = 'e2e-rt' and status = 'running'`;
    // Hub không tự ghi usage: Runtime thật ghi theo `user_id` trong payload job (usage_sql.py; spec X2b §12).
    const p = c.payload;
    await this
      .sql`insert into hub.usage_logs (tenant_id, run_id, step_id, user_id, feature_id, agent_id, provider_key,
        model, billing, input_tokens, output_tokens, cost_usd, overage, latency_ms, job_id)
      values (${p.tenant_id}, ${p.run_id}, ${p.step_id}, ${p.user_id}, null, ${p.agent.id}, ${c.provider},
        null, 'subscription', 100, 20, 0, false, 10, ${c.id})
      on conflict (job_id) where job_id is not null do nothing`;
    await this.emit(runId, c, {
      type: "job.result",
      output,
      usage: { input_tokens: 100, output_tokens: 20 },
      session_resumed: false,
      ...(c.outputs?.length ? { outputs: c.outputs } : {}),
    });
    this.claimed.delete(runId);
  }
}

/** Handler HTTP `/rt/<op>`: body JSON `{run_id, result?}`; op `output`: `{run_id, name, bytes}` (bytes = chữ UTF-8). */
export async function handleRt(rt: FakeRuntime, req: Request): Promise<Response> {
  const op = new URL(req.url).pathname.replace(/^\/rt\//, "");
  const b = (await req.json()) as {
    run_id: string;
    result?: AgentResult;
    name?: string;
    bytes?: string;
  };
  try {
    if (op === "claim") await rt.claim(b.run_id);
    else if (op === "answer" && b.result) await rt.answer(b.run_id, b.result);
    else if (op === "output" && b.name && b.bytes !== undefined)
      return Response.json({ ok: true, id: await rt.output(b.run_id, b.name, b.bytes) });
    else return new Response("bad op", { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    return new Response(String((e as Error).message), { status: 500 });
  }
}
