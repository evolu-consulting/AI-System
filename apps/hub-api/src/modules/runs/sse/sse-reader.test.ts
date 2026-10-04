// m1 review H1 v2 · `connect()` của kết nối chặn reject → kết nối dở bị `disconnect()` (không rò kết nối).
import { describe, expect, it } from "bun:test";
import type { Logger } from "../../../lib/logger";
import type { Redis } from "../../../lib/redis";
import { SseReader } from "./sse-reader";

describe("SseReader · #connection", () => {
  it("connect() reject → disconnect() được gọi", async () => {
    let disconnects = 0;
    const conn = {
      on: () => conn,
      connect: () => Promise.reject(new Error("boom")),
      disconnect: () => {
        disconnects++;
      },
    };
    const redis = { duplicate: () => conn } as unknown as Redis;
    const log = { warn() {}, info() {}, error() {}, debug() {} } as unknown as Logger;
    const ac = new AbortController();
    const reader = new SseReader(redis, log, ac.signal);
    const unsub = reader.subscribe("r1", 0, () => {});
    for (let i = 0; i < 100 && disconnects === 0; i++) await Bun.sleep(10);
    unsub();
    ac.abort();
    expect(disconnects).toBeGreaterThanOrEqual(1);
  });
});
