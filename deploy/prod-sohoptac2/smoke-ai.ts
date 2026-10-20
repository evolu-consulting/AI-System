// sohoptac2 · smoke ai-sub: MỘT lời gọi thật qua AI client chung của Hub (provider gói Claude CLI, feature `contracts.extract`)
// rồi đọc lại dòng `hub.usage_logs` vừa ghi. Chạy: `docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/s2-smoke-ai.ts <tenant-uuid>`
// (compose gắn file này vào image). Không in lời nhắc/đầu ra/token đăng nhập — chỉ ok, model, số token, billing.
import postgres from "postgres";
import { createHubAiClient } from "../../../apps/hub-api/src/lib/ai-client/ai-client.env";
import { connectDb } from "../../../apps/hub-api/src/lib/db";

const tenantId = process.argv[2];
if (!tenantId) throw new Error("cần <tenant-uuid>");
const hubUrl = process.env.HUB_DATABASE_URL;
const ownerUrl = process.env.DATABASE_URL;
if (!hubUrl || !ownerUrl) throw new Error("thiếu HUB_DATABASE_URL/DATABASE_URL");

const db = connectDb(hubUrl, 2);
const ai = createHubAiClient(db);
const t0 = Date.now();
const r = await ai.complete({
  tenantId,
  userId: null,
  feature: "contracts.extract",
  system: "You are a smoke test. Reply with exactly: OK",
  prompt: "Reply with exactly: OK",
  model: "claude-haiku-4-5",
  maxTokens: 64,
  signal: AbortSignal.timeout(120_000),
});
console.log(
  JSON.stringify({
    ready: ai.ready,
    ok: r.ok,
    ...(r.ok ? { model: r.model, usage: r.usage } : { code: r.code }),
    ms: Date.now() - t0,
  }),
);
const sql = postgres(ownerUrl, { max: 1 });
const rows =
  await sql`select feature, provider_key, billing, model, input_tokens, output_tokens, cost_usd, at
  from hub.usage_logs where tenant_id = ${tenantId} and run_id is null order by at desc limit 1`;
console.log(JSON.stringify(rows[0] ?? null));
await sql.end();
process.exit(r.ok && rows[0]?.billing === "subscription" ? 0 : 1);
