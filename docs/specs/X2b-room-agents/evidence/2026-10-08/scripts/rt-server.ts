// UAT X2b · Runtime GIẢ cho hub:dev (HUB_DEV_RUNTIME=none): nhận job `hub.jobs` bằng SQL owner + XADD `run:<id>` (dùng lại FakeRuntime
// của e2e/chat/_x2b-runtime.ts). Điều khiển qua HTTP POST /rt/<claim|answer>. KHÔNG Dify, KHÔNG claude-sub.
// Chạy: bun --env-file=.env.local docs/specs/X2b-room-agents/evidence/2026-10-08/scripts/rt-server.ts
import postgres from "postgres";
import { createRedis } from "../../../../../../apps/hub-api/src/lib/redis";
import { FakeRuntime, handleRt } from "../../../../../../e2e/chat/_x2b-runtime";

const redis = createRedis(process.env.REDIS_URL ?? "redis://localhost:6379");
await redis.connect();
const rt = new FakeRuntime(postgres(process.env.DATABASE_URL ?? "", { max: 2, onnotice: () => {} }), redis);
const sql = postgres(process.env.DATABASE_URL ?? "", { max: 2, onnotice: () => {} });
/** Job Orchestrator: output `{kind:"text", text:<JSON decision>}` (FakeRuntime.answer chỉ ghi `agent_result`). */
async function decide(runId: string, text: string): Promise<void> {
  // biome-ignore lint/suspicious/noExplicitAny: dùng emit riêng tư của FakeRuntime
  const r = rt as any;
  const c = await rt.claim(runId);
  const output = { kind: "text", text };
  await sql`update hub.jobs set status = 'succeeded', result = ${sql.json(output)}, finished_at = now(), pgid = null
    where id = ${c.id} and worker_id = 'e2e-rt' and status = 'running'`;
  await r.emit(runId, c, { type: "job.result", output, usage: { input_tokens: 10, output_tokens: 5 }, session_resumed: false });
  r.claimed.delete(runId);
}
Bun.serve({
  port: 4058,
  idleTimeout: 30,
  fetch: async (req) => {
    const path = new URL(req.url).pathname;
    if (path === "/rt/decide") {
      const b = (await req.json()) as { run_id: string; text: string };
      try {
        await decide(b.run_id, b.text);
        return Response.json({ ok: true });
      } catch (e) {
        return new Response(String((e as Error).message), { status: 500 });
      }
    }
    return path.startsWith("/rt/") ? handleRt(rt, req) : new Response("ok");
  },
});
console.log("[rt] sẵn sàng :4058 (runtime giả)");
