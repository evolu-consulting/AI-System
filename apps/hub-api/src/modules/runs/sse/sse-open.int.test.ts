// HUB-FR-42 · hub-sse-preamble · int: mở E13 cho run đang chạy chưa có sự kiện ⇒ header + byte đầu (`: open`) < 500 ms
// (trước sửa: Bun giữ header tới `: ping` đầu, 15 s).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { SSE_OPEN_FRAME } from "@ai/contracts/chat";
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
import { sseKey } from "./sse-writer";

let sql: Sql;
let k: Keys;
let hub: HubX;

beforeAll(async () => {
  await prepareDb();
  sql = ownerSql();
  await insertFixture(sql);
  await insertHubConfig(sql);
  k = await makeKeys();
  hub = await startHubX(k);
}, 60_000);
afterAll(async () => {
  await hub?.stop();
  await sql?.end();
});

describe("hub-sse-preamble · byte đầu ngay khi mở stream", () => {
  it("E13 run đang chạy, chưa có sự kiện ⇒ 200 + `: open` < 500 ms", async () => {
    // R.runLive: `running`, chủ instance khác, lease 1 giờ; `sse:<id>` rỗng ⇒ không có frame sự kiện nào để gửi.
    await hub.redis.del(sseKey(R.runLive));
    const lan = await sign(k, USERS.lan);
    const t0 = performance.now();
    const res = await fetch(`${hub.base}/runs/${R.runLive}/events`, {
      headers: { authorization: `Bearer ${lan}` },
      signal: AbortSignal.timeout(5_000),
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const first = await reader.read();
    const ms = performance.now() - t0;
    expect([res.status, new TextDecoder().decode(first.value)]).toEqual([200, SSE_OPEN_FRAME]);
    expect(ms).toBeLessThan(500);
    await reader.cancel();
  });
});
