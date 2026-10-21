// one-agent · E12 thật (Hub in-process, DB + Redis thật, runtime giả): (1) `@mgmt-assistant` (flow cũ / bản build cũ của dock)
// ⇒ run `direct` của `assistant` (không 404); (2) tin của dock kèm `context` (surface=contracts, màn hình, id HĐ người gọi KHÔNG
// thấy) ⇒ system prompt của job có khối ngữ cảnh nơi gửi nhưng KHÔNG có id/tên bản ghi.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import type { Redis } from "../../../apps/hub-api/src/lib/redis";
import { type Json, type Keys, makeKeys, type Sql, sign, USERS } from "../H1/_fixtures";
import { type HubX, insertConv, openSse, runIdOf, testRedis } from "../H1/_hub";
import { ScriptRuntime } from "../H1/_runtime";
import { settleRuns, setupH2b, startHubH2b } from "../H2b/_h2b";

let sql: Sql;
let k: Keys;
let hub: HubX;
let redis: Redis;
let rt: ScriptRuntime;

beforeAll(async () => {
  sql = await setupH2b();
  k = await makeKeys();
  hub = await startHubH2b(k);
  redis = await testRedis();
  rt = new ScriptRuntime(sql, redis);
}, 60_000);
afterEach(() => settleRuns(hub, sql, k));
afterAll(async () => {
  await hub?.stop();
  redis?.disconnect();
  await sql?.end();
});

async function dockSend(body: Json) {
  const conv = await insertConv(sql, "lan", crypto.randomUUID());
  const token = await sign(k, USERS.lan);
  const s = await openSse(hub, "POST", `/conversations/${conv}/messages`, {
    token,
    body,
    headers: { "X-Ai-Surface": "contracts" },
  });
  expect(s.status).toBe(200);
  const runId = runIdOf(s);
  const job = await rt.next(runId);
  return { s, job, started: await s.until((e) => e.event === "run.started", 5_000) };
}

describe("one-agent · alias + khối ngữ cảnh dock (E12)", () => {
  it("@mgmt-assistant ⇒ assistant; id HĐ không thấy ⇒ không chèn; nơi gửi + màn hình có", async () => {
    const hidden = "0190dead-0000-7000-8000-00000000c0de";
    const { s, job, started } = await dockSend({
      content: "@mgmt-assistant hợp đồng này hết hạn khi nào?",
      context: {
        surface: "contracts",
        route: `/contracts/${hidden}`,
        entity: { kind: "contract", id: hidden },
      },
    });
    expect(job.payload.agent).toMatchObject({ key: "assistant", role: "agent" });
    expect(started?.data?.responder?.key).toBe("assistant");
    const sp = String(job.payload.system_prompt);
    expect(sp).toContain("Sổ Hợp Tác");
    expect(sp).toContain(`Màn hình đang mở: /contracts/${hidden}`);
    expect(sp).not.toContain("Đang xem");
    expect(sp).not.toContain(`id ${hidden}`);
    await rt.agent(job, { status: "done", text: "Không thấy hợp đồng." });
    const end = await s.terminal(15_000);
    s.close();
    expect(end?.event).toBe("run.finished");
  });
});
