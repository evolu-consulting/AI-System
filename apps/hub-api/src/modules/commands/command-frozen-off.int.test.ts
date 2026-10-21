// commands-unfreeze · int: với HUB_FROZEN_MODULES=off (frozenModules:false) lệnh chat `/dich en` vẫn chạy được:
// E12 → command driver → Dify mock (không gọi Dify thật) → delta + run.finished; đúng một POST /v1/workflows/run.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  type Sql,
  sign,
  USERS,
} from "../../../../../tests/acceptance/H1/_fixtures";
import {
  deltaText,
  type HubX,
  insertConv,
  insertHubConfig,
  openSse,
  testRedis,
} from "../../../../../tests/acceptance/H1/_hub";
import {
  type Dify,
  idGen2,
  insertCatalog,
  startDify,
  startHubH2a,
} from "../../../../../tests/acceptance/H2a/_h2a";
import type { Redis } from "../../lib/redis";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let dify: Dify;
const id = idGen2(9800);

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  dify = startDify();
  await insertCatalog(sql, { baseUrl: dify.baseUrl });
  k = await makeKeys();
  hub = await startHubH2a(k, { frozenModules: false } as never);
  redis = await testRedis();
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await dify?.close();
  redis?.disconnect();
  await sql?.end();
});

describe("commands-unfreeze · lệnh → Dify mock khi module đóng băng tắt", () => {
  it("/dich en (frozenModules:false): 200, đúng 1 POST workflows/run, kết quả = nối delta", async () => {
    dify.mock.reset();
    const conv = await insertConv(sql, "lan", id());
    const s = await openSse(hub, "POST", `/conversations/${conv}/messages`, {
      token: await sign(k, USERS.lan),
      body: { content: "/dich en", context: { selection: "xin chào" } },
    });
    try {
      expect(s.status).toBe(200);
      await s.terminal(8_000);
    } finally {
      s.close();
    }
    expect(dify.runs().map((r) => r.path)).toEqual(["/v1/workflows/run"]);
    const end = s.events.find((e) => e.event === "run.finished");
    expect(end?.data?.content).toBe("Xin chào, đây là mock.");
    expect(end?.data?.content).toBe(deltaText(s.events));
  });
});
