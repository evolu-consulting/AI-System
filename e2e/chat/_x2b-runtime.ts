// HUB-FR-101 · HUB-FR-103 · e2e X2b · Runtime GIẢ chạy trong tiến trình stack (bun): claim `hub.jobs` bằng SQL owner rồi XADD
// `run:<id>` (Redis) theo `@ai/contracts/hub` — giống `tests/acceptance/H1/_runtime.ts` nhưng không phụ thuộc `bun:test`.
// Test (Playwright, node) điều khiển qua HTTP `POST /rt/<op>` ở cổng "sẵn sàng" của stack. KHÔNG Dify, KHÔNG `claude-sub`.
import {
  type AgentResult,
  RUN_STREAM_FIELD,
  RunEventSchema,
  runStreamKey,
} from "@ai/contracts/hub";
import type postgres from "postgres";
import type { Redis } from "../../apps/hub-api/src/lib/redis";

type Claimed = { id: string; provider: string; seq: number };

export class FakeRuntime {
  private readonly claimed = new Map<string, Claimed>();
  constructor(
    private readonly sql: postgres.Sql,
    private readonly redis: Redis,
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
      const rows = await this.sql<{ id: string; payload: { provider_key?: string } }[]>`
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

  /** Kết thúc job bằng `agent_result` (done / need_input / ...). */
  async answer(runId: string, result: AgentResult): Promise<void> {
    const c = await this.claim(runId);
    const output = { kind: "agent_result", result };
    await this.sql`update hub.jobs set status = 'succeeded', result = ${this.sql.json(output)},
      finished_at = now(), pgid = null where id = ${c.id} and worker_id = 'e2e-rt' and status = 'running'`;
    await this.emit(runId, c, {
      type: "job.result",
      output,
      usage: { input_tokens: 100, output_tokens: 20 },
      session_resumed: false,
    });
    this.claimed.delete(runId);
  }
}

/** Handler HTTP `/rt/<op>`: body JSON `{run_id, result?}`. */
export async function handleRt(rt: FakeRuntime, req: Request): Promise<Response> {
  const op = new URL(req.url).pathname.replace(/^\/rt\//, "");
  const b = (await req.json()) as { run_id: string; result?: AgentResult };
  try {
    if (op === "claim") await rt.claim(b.run_id);
    else if (op === "answer" && b.result) await rt.answer(b.run_id, b.result);
    else return new Response("bad op", { status: 400 });
    return Response.json({ ok: true });
  } catch (e) {
    return new Response(String((e as Error).message), { status: 500 });
  }
}
