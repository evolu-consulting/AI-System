// ai-sub · AI client chung trên GÓI Claude (Postgres thật, role hub_api, runner CLI GIẢ — không AI thật, không CLI thật):
// (1) định tuyến theo tính năng: `contracts.extract` = gói ⇒ dòng usage billing `subscription`, provider `claude-sub`, chi phí 0,
//     maxTokens truyền vào CLI qua env; `knowledge.rerank` = api nhưng không có khoá ⇒ `UNAVAILABLE`, không dòng, không chạy CLI;
// (2) trần token/tenant/ngày áp cho gói: dùng hết trần ⇒ `CAP_EXCEEDED`, CLI KHÔNG chạy; chỗ giữ được trả (0 hàng giữ chỗ);
// (3) CLI báo chưa đăng nhập ⇒ `UNAVAILABLE`, vẫn ghi một dòng (usage 0) và trả chỗ giữ;
// (4) `hub.log_ai_usage_billed` chỉ nhận `api` | `subscription`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHubAiClient } from "../../../apps/hub-api/src/lib/ai-client/ai-client.env";
import type {
  CliOutput,
  CliRun,
} from "../../../apps/hub-api/src/lib/ai-client/claude-cli.provider";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { HUB_API_URL } from "../H1/_fixtures";
import { setupX2a } from "../X2a/_x2a";

type Sql = Awaited<ReturnType<typeof setupX2a>>;
const TA = "a5b00000-0000-4000-8000-0000000000a1";
const TB = "a5b00000-0000-4000-8000-0000000000b2";
const TC = "a5b00000-0000-4000-8000-0000000000c3";
const U = "a5b00000-0000-4000-8000-0000000000d4";

let sql: Sql;
let db: ReturnType<typeof connectDb>;
beforeAll(async () => {
  sql = await setupX2a();
  db = connectDb(HUB_API_URL, 4);
}, 120_000);
afterAll(async () => {
  await db?.close();
  await sql?.end();
});

const okJson = (input: number, output: number) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    result: '{"ok":true}',
    usage: { input_tokens: input, output_tokens: output, cache_read_input_tokens: 5 },
    modelUsage: { "claude-opus-5-5": { outputTokens: output } },
  });

function fakeCli(out: () => CliOutput) {
  const seen: { argv: string[]; env: Record<string, string>; stdin: string }[] = [];
  const run: CliRun = async (argv, o) => {
    seen.push({ argv, env: o.env, stdin: o.stdin });
    return out();
  };
  return { run, seen };
}

const ENV = {
  AI_PROVIDER: "subscription",
  AI_PROVIDER_KNOWLEDGE_RERANK: "api",
  AI_SUB_CLI_PATH: "/opt/fake/claude",
  ANTHROPIC_API_KEY: "",
  PATH: "/usr/bin",
  HOME: "/home/aisys",
};
const client = (run: CliRun, cap: string) =>
  createHubAiClient(db, {
    env: { ...ENV, AI_TENANT_DAILY_TOKENS: cap },
    sub: { run, which: (p) => p },
  });
const req = (tenantId: string, feature = "contracts.extract") => ({
  tenantId,
  userId: U,
  feature,
  model: "claude-opus-5-5",
  system: "s",
  prompt: "văn bản hợp đồng",
  maxTokens: 2_000,
  signal: new AbortController().signal,
});
const rowsOf = (t: string) =>
  sql<
    {
      feature: string;
      billing: string;
      provider_key: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens: number;
      cost_usd: string | null;
    }[]
  >`select feature, billing, provider_key, model, input_tokens, output_tokens, cache_read_tokens, cost_usd
    from hub.usage_logs where tenant_id = ${t} order by at`;
const holds = async (t: string) =>
  Number(
    (
      await sql<
        { n: string }[]
      >`select count(*) as n from hub.ai_token_holds where tenant_id = ${t}`
    )[0]?.n,
  );

describe("ai-sub · AI client trên gói Claude", () => {
  it("contracts.extract = gói ⇒ dòng billing subscription, chi phí 0, maxTokens qua env CLI; rerank = api không khoá ⇒ UNAVAILABLE", async () => {
    const cli = fakeCli(() => ({ exitCode: 0, stdout: okJson(1200, 300), stderr: "" }));
    const ai = client(cli.run, "1000000");
    expect(ai.ready).toBe(true);
    const out = await ai.complete(req(TA));
    expect(out).toMatchObject({ ok: true, text: '{"ok":true}', model: "claude-opus-5-5" });
    expect(cli.seen).toHaveLength(1);
    expect(cli.seen[0]?.argv[0]).toBe("/opt/fake/claude");
    expect(cli.seen[0]?.stdin).toBe("văn bản hợp đồng");
    expect(cli.seen[0]?.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("2000");
    expect(cli.seen[0]?.env.ANTHROPIC_API_KEY).toBeUndefined();
    const rows = await rowsOf(TA);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "contracts.extract",
      billing: "subscription",
      provider_key: "claude-sub",
      model: "claude-opus-5-5",
      input_tokens: 1200,
      output_tokens: 300,
      cache_read_tokens: 5,
    });
    expect(Number(rows[0]?.cost_usd)).toBe(0);
    expect(await ai.complete(req(TA, "knowledge.rerank"))).toEqual({
      ok: false,
      code: "UNAVAILABLE",
    });
    expect(cli.seen).toHaveLength(1);
    expect(await rowsOf(TA)).toHaveLength(1);
    expect(await holds(TA)).toBe(0);
  });

  it("trần áp cho gói: dùng hết trần ⇒ CAP_EXCEEDED, CLI không chạy; tenant khác vẫn gọi được", async () => {
    const cli = fakeCli(() => ({ exitCode: 0, stdout: okJson(1500, 1600), stderr: "" }));
    const ai = client(cli.run, "3000");
    expect((await ai.complete(req(TB))).ok).toBe(true); // 3100 ≥ trần 3000
    expect(await ai.complete(req(TB))).toEqual({ ok: false, code: "CAP_EXCEEDED" });
    expect(cli.seen).toHaveLength(1);
    expect((await rowsOf(TB)).map((r) => r.billing)).toEqual(["subscription"]);
    expect(await holds(TB)).toBe(0);
  });

  it("CLI chưa đăng nhập ⇒ UNAVAILABLE, vẫn ghi một dòng usage 0 billing subscription, trả chỗ giữ", async () => {
    const stdout = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: true,
      result: "Invalid API key · Please run /login",
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const cli = fakeCli(() => ({ exitCode: 1, stdout, stderr: "" }));
    const ai = client(cli.run, "1000000");
    expect(await ai.complete(req(TC))).toEqual({ ok: false, code: "UNAVAILABLE" });
    const rows = await rowsOf(TC);
    expect(rows.map((r) => [r.billing, r.input_tokens, r.output_tokens])).toEqual([
      ["subscription", 0, 0],
    ]);
    expect(await holds(TC)).toBe(0);
  });

  it("hub.log_ai_usage_billed chỉ nhận api | subscription", async () => {
    // postgres.js chỉ chạy câu khi `.then` được gọi — `expect(query).rejects` của bun không gọi ⇒ treo; await tường minh.
    let err: unknown = null;
    try {
      await sql`select hub.log_ai_usage_billed(${TC}::uuid, null, 'x.y', 'p', 'm', 1, 1, 0, 0, 0, 1, 'dify')`;
    } catch (e) {
      err = e;
    }
    expect(String(err)).toMatch(/invalid billing/);
  });
});
