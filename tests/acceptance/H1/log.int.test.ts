// HUB-NFR-04 · test-plan H1 §5 A52: log hub-api trong một run có `run_id, tenant_id, user_id`; không chứa nội dung tin
// (chuỗi mồi), không chứa JWT. Bắt dòng log qua `setSink` của logger hub-api; hộp đen phần còn lại (HTTP + DB + Redis).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { setSink } from "../../../apps/hub-api/src/lib/logger";
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
} from "./_fixtures";
import {
  type HubX,
  idGen,
  insertConv,
  insertHubConfig,
  runIdOf,
  send,
  startHubX,
  testRedis,
} from "./_hub";
import { ScriptRuntime } from "./_runtime";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;
const id = idGen(7000);
const lines: string[] = [];
let restore: () => void = () => {};

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  restore = setSink((_level, line) => lines.push(line));
  hub = await startHubX(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterAll(async () => {
  restore();
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

describe("A52 · log có ngữ cảnh run, không lộ nội dung/JWT [HUB-NFR-04]", () => {
  it("A52 · một run: có dòng log mang run_id, tenant_id, user_id; không dòng nào chứa chuỗi mồi nội dung tin, câu trả lời hay JWT [HUB-NFR-04]", async () => {
    const SECRET_MSG = "MOI-NOI-DUNG-TIN-A52-7f3c";
    const SECRET_ANS = "MOI-CAU-TRA-LOI-A52-91ab";
    const token = await sign(k, USERS.lan);
    const conv = await insertConv(sql, "lan", id());
    const from = lines.length;
    const s = await send(hub, token, conv, `Xin chào ${SECRET_MSG}`);
    expect(s.status).toBe(200);
    const runId = runIdOf(s);
    const job = await rt.next(runId);
    await rt.decide(job, { decision: "answer", text: `Trả lời ${SECRET_ANS}` });
    expect((await s.terminal())?.event).toBe("run.finished");
    s.close();
    const mine = lines.slice(from);
    const withCtx = mine.filter(
      (l) => l.includes(runId) && l.includes(USERS.lan.tid) && l.includes(USERS.lan.id),
    );
    expect(withCtx.length).toBeGreaterThan(0);
    for (const l of mine) {
      expect(l).not.toContain(SECRET_MSG);
      expect(l).not.toContain(SECRET_ANS);
      expect(l).not.toContain(token);
      expect(l).not.toContain(token.split(".")[1] ?? token);
    }
  });
});
