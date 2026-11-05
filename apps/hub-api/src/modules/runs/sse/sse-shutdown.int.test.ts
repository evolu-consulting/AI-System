// HUB-NFR-04 · hub-sse-shutdown · int: tắt instance khi còn stream SSE mở (2 luồng run E13 + /me/stream) ⇒ `stop` xong < 1 s.
// Trước sửa: phiên run đóng-do-abort cùng tick ⇒ Bun 1.3.14 treo `server.stop(true)` mãi (lib/sse-shutdown).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  insertFixture,
  type Keys,
  makeKeys,
  ownerSql,
  prepareDb,
  R,
  type Sql,
  sign,
  USERS,
} from "../../../../../../tests/acceptance/H1/_fixtures";
import { type HubX, insertHubConfig, startHubX } from "../../../../../../tests/acceptance/H1/_hub";
import { SSE_FIELD, sseKey } from "./sse-writer";

let sql: Sql;
let k: Keys;
let hub: HubX | undefined;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  hub = await startHubX(k);
}, 60_000);
afterAll(async () => {
  await sql?.end();
});

const open = async (h: HubX, token: string, path: string): Promise<Response> => {
  const res = await fetch(`${h.base}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  expect([path, res.status, res.headers.get("content-type")]).toEqual([
    path,
    200,
    expect.stringContaining("text/event-stream"),
  ]);
  return res;
};

describe("hub-sse-shutdown · tắt instance khi còn SSE mở", () => {
  it("2 luồng run (1 client huỷ thân, 1 giữ) + /me/stream ⇒ hub.stop() xong < 1 s", async () => {
    const h = hub as HubX;
    const lan = await sign(k, USERS.lan);
    // R.runLive: `running`, chủ instance khác, lease 1 giờ ⇒ stream theo dõi, không tự đóng trong ca. Có sẵn `run.started`
    // (id 1): Bun chỉ gửi header khi có byte đầu ⇒ fetch mới trả về.
    const key = sseKey(R.runLive);
    await h.redis.del(key);
    await h.redis.xadd(key, "1-0", SSE_FIELD, JSON.stringify({ event: "run.started", data: {} }));
    const a = await open(h, lan, `/runs/${R.runLive}/events`);
    const b = await open(h, lan, `/runs/${R.runLive}/events`);
    const me = await open(h, lan, "/me/stream");
    await a.body?.cancel(); // như `call()`: Bun fetch huỷ thân KHÔNG báo server ⇒ phiên server vẫn mở
    const t0 = performance.now();
    hub = undefined;
    const stopped = h.stop().then(() => "stopped" as const);
    const hung = new Promise<"hung">((r) => setTimeout(() => r("hung"), 1_500));
    expect(await Promise.race([stopped, hung])).toBe("stopped");
    expect(performance.now() - t0).toBeLessThan(1_000);
    await Promise.allSettled([b.body?.cancel(), me.body?.cancel()]);
  });
});
