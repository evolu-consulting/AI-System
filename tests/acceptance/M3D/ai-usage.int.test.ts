// M3-decouple · AI client chung: (1) mỗi lời gọi model ghi MỘT dòng `hub.usage_logs` (tenant, người, tính năng, model, token, chi
// phí) qua hàm SECURITY DEFINER bằng role `hub_api`; (2) trần token/tenant/ngày đọc từ bảng: vượt ⇒ `CAP_EXCEEDED` và KHÔNG gọi
// model; tenant khác không bị ảnh hưởng; đọc trần lỗi ⇒ `UNAVAILABLE` (đóng an toàn); (3) usage chat (M2 `noteChatUsage`, đường
// chung của `runJob`) được `createApp` nối vào cùng bảng, feature `chat`, theo tenant. Model giả (không AI thật).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createApp } from "../../../apps/hub-api/src/app";
import {
  createAiClient,
  type ModelProvider,
} from "../../../apps/hub-api/src/lib/ai-client/ai-client";
import { pgUsageStore } from "../../../apps/hub-api/src/lib/ai-client/usage.pg";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import {
  chatUsageSettled,
  noteChatUsage,
  setChatUsageSink,
} from "../../../apps/hub-api/src/modules/usage/chat-usage";
import { HUB_API_URL } from "../H1/_fixtures";
import { setupX2a } from "../X2a/_x2a";

type Sql = Awaited<ReturnType<typeof setupX2a>>;
const TA = "a3d00000-0000-4000-8000-0000000000a1";
const TB = "a3d00000-0000-4000-8000-0000000000b2";
const U = "a3d00000-0000-4000-8000-0000000000c3";

let sql: Sql;
let db: ReturnType<typeof connectDb>;
beforeAll(async () => {
  sql = await setupX2a();
  db = connectDb(HUB_API_URL, 4);
}, 120_000);
afterAll(async () => {
  setChatUsageSink(null);
  await db?.close();
  await sql?.end();
});

function provider(): ModelProvider & { calls: number } {
  const p = {
    key: "fake",
    calls: 0,
    complete: async (r: { model: string }) => {
      p.calls += 1;
      return {
        ok: true as const,
        text: "{}",
        model: r.model,
        usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200, cacheWriteTokens: 0 },
      };
    },
  };
  return p;
}
const req = (tenantId: string) => ({
  tenantId,
  userId: U,
  feature: "contracts.extract",
  model: "claude-opus-5-5",
  system: "s",
  prompt: "p",
  signal: new AbortController().signal,
});
const rowsOf = (t: string) =>
  sql<
    {
      feature: string;
      model: string;
      billing: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cost_usd: string;
      user_id: string;
      provider_key: string;
    }[]
  >`select feature, model, billing, input_tokens, output_tokens, cache_read_tokens, cost_usd, user_id, provider_key
    from hub.usage_logs where tenant_id = ${t} order by at`;

describe("M3 · AI client chung · usage + trần theo tenant", () => {
  it("một lời gọi ⇒ một dòng usage_logs billing api (feature, model, token, chi phí theo bảng giá)", async () => {
    const p = provider();
    const ai = createAiClient({
      provider: p,
      usage: pgUsageStore(db),
      caps: { dailyTokens: async () => null },
    });
    const out = await ai.complete(req(TA));
    expect(out.ok).toBe(true);
    const rows = await rowsOf(TA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "contracts.extract",
      model: "claude-opus-5-5",
      billing: "api",
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_tokens: 200,
      user_id: U,
      provider_key: "fake",
    });
    // 1000×4 + 500×20 + 200×0.2 = 14 040 micro-USD
    expect(Number(rows[0]?.cost_usd)).toBeCloseTo(0.01404, 6);
  });

  it("trần token/ngày: tenant A đã dùng ≥ trần ⇒ CAP_EXCEEDED, model KHÔNG được gọi; tenant B vẫn gọi được", async () => {
    const p = provider();
    const ai = createAiClient({
      provider: p,
      usage: pgUsageStore(db),
      caps: { dailyTokens: async () => 1500 },
    });
    expect(await ai.complete(req(TA))).toEqual({ ok: false, code: "CAP_EXCEEDED" });
    expect(p.calls).toBe(0);
    expect((await ai.complete(req(TB))).ok).toBe(true);
    expect(p.calls).toBe(1);
    expect(await rowsOf(TA)).toHaveLength(1);
  });

  it("đọc trần lỗi ⇒ UNAVAILABLE (đóng an toàn, không gọi); chưa có khoá ⇒ UNAVAILABLE, 0 SQL", async () => {
    const p = provider();
    const broken = createAiClient({
      provider: p,
      usage: {
        record: async () => undefined,
        tokensSince: async () => Promise.reject(new Error("db")),
      },
      caps: { dailyTokens: async () => 10 },
    });
    expect(await broken.complete(req(TA))).toEqual({ ok: false, code: "UNAVAILABLE" });
    const none = createAiClient({
      provider: null,
      usage: pgUsageStore(db),
      caps: { dailyTokens: async () => 10 },
    });
    expect(await none.complete(req(TA))).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(p.calls).toBe(0);
  });
});

describe("M3 · usage chat (M2) — một nguồn duy nhất", () => {
  it("runtime đã ghi usage của job ⇒ Hub chỉ gắn feature chat (không chèn dòng thứ hai), lặp lại vẫn 1 dòng; bước stage quy trình không đụng; tính vào trần tenant", async () => {
    const ac = new AbortController();
    createApp({ version: "0.0.0-test", corsOrigins: [] }, {
      db,
      signal: ac.signal,
      appEnv: "test",
    } as never);
    ac.abort();
    const run = crypto.randomUUID();
    const stageRun = crypto.randomUUID();
    // Dòng usage do runtime agent ghi lúc kết thúc job (finish_sql.py) — nguồn duy nhất.
    for (const r of [run, stageRun])
      await sql`insert into hub.usage_logs (tenant_id, run_id, user_id, provider_key, model, billing,
          input_tokens, output_tokens, cost_usd)
        values (${TB}, ${r}, ${U}, 'claude-sub', 'claude-opus-5-5', 'api', 70, 30, 0.00088)`;
    const task = (id: string, stageRunId: string | null) => ({
      run: { id, tenantId: TB, userId: U },
      agent: { id: crypto.randomUUID(), key: "mgmt-assistant", runtime: "agentic-cli" },
      stageRunId,
    });
    noteChatUsage(task(run, null), { input_tokens: 70, output_tokens: 30 } as never, true);
    noteChatUsage(task(run, null), { input_tokens: 70, output_tokens: 30 } as never, true); // bước 2 cùng run
    noteChatUsage(task(stageRun, "stage-1"), { input_tokens: 1, output_tokens: 1 } as never, true);
    await chatUsageSettled(); // sink ghi bất đồng bộ (không chặn run) — chờ tín hiệu xong
    const rows = await sql<
      { feature: string | null; input_tokens: number }[]
    >`select feature, input_tokens
      from hub.usage_logs where tenant_id = ${TB} and run_id = any(${[run, stageRun]}::uuid[]) order by feature`;
    expect(rows.map((r) => [r.feature, r.input_tokens])).toEqual([
      ["chat", 70],
      [null, 70],
    ]);
    const [cap] = await sql<
      { n: string }[]
    >`select hub.ai_tokens_since(${TB}, now() - interval '1 hour') as n`;
    expect(Number(cap?.n)).toBeGreaterThanOrEqual(100); // dòng chat tính vào trần
  });
});
