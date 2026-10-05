// HUB-BR-04 · WRK-FR-15 · H3a-R10 · HUB-H3a-AC-07 · CR-041 · test-plan-cases H3a §2.4 A18–A19 (+ A09): command `/` (Dify,
// sync/async) không bị chặn khi provider subscription của Orchestrator đang `cooldown` — không dùng provider này.
// Mock Dify H2a (MK, key `mk-ok`) sau proxy `_h2a.ts`; async: `ScriptRuntime2` đóng vai Runtime cho job `workflow.async`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import {
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  USERS,
} from "../H1/_fixtures";
import { type HubX, insertConv, insertHubConfig, runIdOf, send, testRedis } from "../H1/_hub";
import { type Dify, insertCatalog, startDify, startHubH2a } from "../H2a/_h2a";
import { ScriptRuntime2 } from "../H2a/_runtime2";
import { endOf, jobsOfRun, PROVIDER, resetProvider, setProvider } from "./_h3a";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt2: ScriptRuntime2;
let dify: Dify;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl, extras: true });
  k = await makeKeys();
  hub = await startHubH2a(k, { instanceId: "qc-hub-h3a-cmd" });
  redis = await testRedis();
  rt2 = new ScriptRuntime2(sql, redis, "qc-rt-h3a-cmd");
  await setProvider(sql, "cooldown", 3_600_000);
}, 60_000);
afterAll(async () => {
  if (sql) await resetProvider(sql);
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

async function open(content: string) {
  const conv = await insertConv(sql, "lan", crypto.randomUUID());
  const s = await send(hub, await sign(k, USERS.lan), conv, content);
  expect(s.status).toBe(200);
  return { s, runId: runIdOf(s) };
}

describe("A18–A19 · command `/` không bị chặn khi provider subscription cooldown [H3a-R10 · HUB-H3a-AC-07 · CR-041]", () => {
  it("WRK-FR-15 · A18 · cooldown +1 h + /dich sync → run.finished; MK đúng 1 POST /v1/workflows/run; 0 job provider subscription [H3a-R10 · HUB-H3a-AC-07]", async () => {
    dify.mock.reset();
    const r = await open("/dich en xin chào");
    const end = await endOf(r.s, 8_000);
    expect(end.event).toBe("run.finished");
    expect(dify.runs().map((c) => c.path)).toEqual(["/v1/workflows/run"]);
    expect((await jobsOfRun(sql, r.runId)).filter((j) => j.provider_key === PROVIDER)).toEqual([]);
  });

  it("WRK-FR-15 · A19 · cooldown +1 h + /dich-async → job workflow.async (provider dify) được tạo; Runtime trả kết quả → run.finished [H3a-R10 · HUB-H3a-AC-07]", async () => {
    const r = await open("/dich-async en xin chào");
    const a = await rt2.claimAsync(r.runId);
    const jobs = await jobsOfRun(sql, r.runId);
    expect(jobs.map((j) => ({ type: j.type, provider_key: j.provider_key }))).toEqual([
      { type: "workflow.async", provider_key: "dify" },
    ]);
    await rt2.rt.text(a.job, "Kết quả dịch async A19.");
    const end = await endOf(r.s, 8_000);
    expect(end.event).toBe("run.finished");
    expect(end.data?.content).toBe("Kết quả dịch async A19.");
  });
});
