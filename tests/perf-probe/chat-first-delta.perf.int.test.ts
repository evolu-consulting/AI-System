// CR-116 · kịch bản `chat.first-delta`: gửi tin (E12) → delta đầu tới SSE, Runtime giả (ScriptRuntime3, không LLM). Đo wall từ
// lúc gửi tới delta đầu tới client (chờ bằng vòng 5 ms của `arrival` ⇒ lượng tử ≤ 5 ms). small = 20 tin/lượt; large = 100.
// Fixture dùng lại của PF3 (`tests/acceptance/H2b/perf.perf.int.test.ts`).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { probe } from "@ai/db/probe";
import type { Redis } from "../../apps/hub-api/src/lib/redis";
import { type Keys, makeKeys, type Sql, sign, USERS } from "../acceptance/H1/_fixtures";
import { type HubX, testRedis } from "../acceptance/H1/_hub";
import { ScriptRuntime3, settleRuns, setupH2b, startHubH2b } from "../acceptance/H2b/_h2b";
import { answer, arrival, deltasOf, startRun } from "../acceptance/H2b/_stream";
import { probing, runScenario } from "./_scn";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime3;
let token = "";

beforeAll(async () => {
  if (!probing) return;
  sql = await setupH2b();
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime3(sql, redis);
  token = await sign(k, USERS.lan);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

describe.skipIf(!probing)("probe · chat.first-delta (PF3)", () => {
  it("chat.first-delta · gửi tin → delta đầu", async () => {
    await runScenario("chat.first-delta", sql, async (r, size) => {
      for (let i = 0; i < (size === "large" ? 100 : 20); i++) {
        let finish: () => Promise<void> = async () => {};
        await probe("chat.first-delta", async () => {
          const x = await startRun(hub, sql, token, { who: "lan", content: `Đo probe ${r}/${i}` });
          const job = await rt.next(x.runId);
          await rt.delta(job, "answer", "Mẫu đầu. ");
          const at = await arrival(() => deltasOf(x.s).length >= 1, 5_000);
          expect(at).toBeLessThan(Number.POSITIVE_INFINITY);
          finish = async () => {
            await rt.decide(job, answer("Mẫu đầu. "));
            await x.s.terminal(10_000);
            x.s.close();
            await settleRuns(hub, sql, k);
          };
        });
        await finish();
      }
    });
  }, 900_000);
});
