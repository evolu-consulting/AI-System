// M3c · review B #13/#14 · trần token tenant/ngày chịu được đua (Postgres thật, role hub_api, model giả — KHÔNG AI thật):
// (1) 10 lời gọi ĐỒNG THỜI của một tenant (mọi lời gọi được nhận đều bị giữ trong model tới khi cả 10 đã quyết) ⇒ tổng token đã
//     ghi ≤ trần (giữ chỗ nguyên tử trước khi gọi, `maxTokens` = phần được cấp); phần dư bị `CAP_EXCEEDED`, model không được gọi;
//     sau khi xong không còn hàng giữ chỗ (quyết toán); (2) model lỗi giữa chừng có usage một phần ⇒ vẫn ghi MỘT dòng usage và
//     tính vào trần. Chờ bằng tín hiệu (barrier), không sleep/poll.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  createAiClient,
  type ModelProvider,
  type ModelRequest,
} from "../../../apps/hub-api/src/lib/ai-client/ai-client";
import { pgUsageStore } from "../../../apps/hub-api/src/lib/ai-client/usage.pg";
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { HUB_API_URL } from "../H1/_fixtures";
import { setupX2a } from "../X2a/_x2a";

type Sql = Awaited<ReturnType<typeof setupX2a>>;
const TC = "a3d00000-0000-4000-8000-0000000000d4";
const TE = "a3d00000-0000-4000-8000-0000000000e5";
const U = "a3d00000-0000-4000-8000-0000000000c3";
const N = 10;
const CAP = 5_000;
const MAX_OUT = 1_000;

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

const req = (tenantId: string) => ({
  tenantId,
  userId: U,
  feature: "contracts.extract",
  model: "claude-opus-5-5",
  system: "s",
  prompt: "p",
  maxTokens: MAX_OUT,
  signal: new AbortController().signal,
});
const used = async (t: string) =>
  Number(
    (
      await sql<{ n: string }[]>`select coalesce(sum(input_tokens + output_tokens), 0) as n
        from hub.usage_logs where tenant_id = ${t}`
    )[0]?.n ?? 0,
  );

describe("M3c · trần token chịu đua [review B #13]", () => {
  it(`${N} lời gọi đồng thời ⇒ tổng token ghi ≤ trần ${CAP}; phần dư CAP_EXCEEDED, model không được gọi`, async () => {
    let entered = 0;
    let early = 0;
    let open: () => void = () => undefined;
    const gate = new Promise<void>((res) => {
      open = res;
    });
    const check = () => {
      if (entered + early === N) open();
    };
    // Model giả dùng HẾT phần output được cấp (trường hợp xấu nhất) và giữ lời gọi tới khi cả N đã quyết.
    const provider: ModelProvider = {
      key: "fake",
      complete: async (r: ModelRequest) => {
        entered += 1;
        check();
        await gate;
        const usage = {
          inputTokens: 1,
          outputTokens: r.maxTokens,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        };
        return { ok: true, text: "{}", model: r.model, usage };
      },
    };
    const ai = createAiClient({
      provider,
      usage: pgUsageStore(db),
      caps: { dailyTokens: async () => CAP },
    });
    const calls = Array.from({ length: N }, () =>
      ai.complete(req(TC)).then((out) => {
        if (entered + early < N) {
          early += 1;
          check();
        }
        return out;
      }),
    );
    const outs = await Promise.all(calls);
    const ok = outs.filter((o) => o.ok).length;
    const capped = outs.filter((o) => !o.ok && o.code === "CAP_EXCEEDED").length;
    expect({ ok: ok > 0, total: ok + capped }).toEqual({ ok: true, total: N });
    expect(entered).toBe(ok);
    expect(await used(TC)).toBeLessThanOrEqual(CAP);
    const [h] = await sql<{ n: number }[]>`select count(*)::int as n from hub.ai_token_holds
      where tenant_id = ${TC}`;
    expect(h?.n).toBe(0); // quyết toán xong ⇒ không còn giữ chỗ
  });
});

describe("M3c · usage khi model lỗi giữa chừng [review B #14]", () => {
  it("model lỗi có usage một phần ⇒ vẫn ghi MỘT dòng usage, tính vào trần", async () => {
    const provider: ModelProvider = {
      key: "fake",
      complete: async (r: ModelRequest) => ({
        ok: false,
        code: "FAILED",
        model: r.model,
        usage: { inputTokens: 700, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
    };
    const ai = createAiClient({
      provider,
      usage: pgUsageStore(db),
      caps: { dailyTokens: async () => 10_000 },
    });
    expect(await ai.complete(req(TE))).toEqual({ ok: false, code: "FAILED" });
    expect(await used(TE)).toBe(750);
  });
});
