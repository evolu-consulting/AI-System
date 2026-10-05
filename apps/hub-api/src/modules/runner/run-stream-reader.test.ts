// m1 review H1 v2 · `connect()` của kết nối chặn reject → kết nối dở bị `disconnect()` (không rò kết nối).
// REVIEW 1 Hub #4/#5 · `CLIENT ID` lấy lại ở mỗi `ready`; UNBLOCK trả 0 (tới trước khi XREAD chặn) → thử lại; sub mới
// bắt đầu từ id cuối của `run:<id>` (XREVRANGE), không đọc lại từ `0-0`.
import { describe, expect, it } from "bun:test";
import type { Logger } from "../../lib/logger";
import type { Redis } from "../../lib/redis";
import { RunStreamReader } from "./run-stream-reader";

const log = { warn() {}, info() {}, error() {}, debug() {} } as unknown as Logger;
const until = async (ok: () => boolean) => {
  for (let i = 0; i < 200 && !ok(); i++) await Bun.sleep(5);
};

describe("RunStreamReader · #connection", () => {
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
    const ac = new AbortController();
    const reader = new RunStreamReader(redis, log, ac.signal);
    const unsub = await reader.subscribe("r1", () => {});
    for (let i = 0; i < 100 && disconnects === 0; i++) await Bun.sleep(10);
    unsub();
    ac.abort();
    expect(disconnects).toBeGreaterThanOrEqual(1);
  });
});

/** Kết nối chặn giả: XREAD treo tới khi `release()`; `CLIENT ID` trả `ids` lần lượt; ghi lại STREAMS của mỗi XREAD. */
function fakeRedis(o: { ids: number[]; unblockReplies: number[]; tail?: string }) {
  const handlers = new Map<string, () => void>();
  const xreads: string[][] = [];
  const unblocks: string[] = [];
  let release: (() => void) | null = null;
  let idIdx = 0;
  const conn = {
    on: (ev: string, fn: () => void) => {
      handlers.set(ev, fn);
      return conn;
    },
    connect: async () => handlers.get("ready")?.(),
    disconnect: () => {},
    call: (...a: unknown[]) => {
      if (a[0] === "CLIENT") return Promise.resolve(o.ids[Math.min(idIdx++, o.ids.length - 1)]);
      xreads.push(a.slice(4).map(String));
      return new Promise((res) => {
        release = () => res(null);
      });
    },
  };
  const redis = {
    duplicate: () => conn,
    call: (...a: unknown[]) => {
      if (a[0] === "XREVRANGE") return Promise.resolve(o.tail ? [[o.tail, []]] : []);
      unblocks.push(String(a[2]));
      return Promise.resolve(o.unblockReplies.shift() ?? 1);
    },
  } as unknown as Redis;
  return {
    redis,
    xreads,
    unblocks,
    emit: (ev: string) => handlers.get(ev)?.(),
    release: () => release?.(),
  };
}

describe("RunStreamReader · REVIEW 1 Hub #4/#5", () => {
  it("#5 · sub mới đọc từ id cuối của run:<id> (XREVRANGE), không 0-0", async () => {
    const f = fakeRedis({ ids: [7], unblockReplies: [], tail: "1700-3" });
    const ac = new AbortController();
    const unsub = await new RunStreamReader(f.redis, log, ac.signal).subscribe("r1", () => {});
    await until(() => f.xreads.length > 0);
    expect(f.xreads[0]).toEqual(["run:r1", "1700-3"]);
    unsub();
    ac.abort();
    f.release();
  });

  it("#4 · nối lại (ready) → CLIENT ID mới dùng cho UNBLOCK; UNBLOCK trả 0 → thử lại tới khi 1", async () => {
    const f = fakeRedis({ ids: [7, 9], unblockReplies: [0, 0, 1] });
    const ac = new AbortController();
    const reader = new RunStreamReader(f.redis, log, ac.signal);
    const u1 = await reader.subscribe("r1", () => {});
    await until(() => f.xreads.length > 0);
    f.emit("close");
    f.emit("ready");
    await Bun.sleep(5);
    const u2 = await reader.subscribe("r2", () => {});
    await until(() => f.unblocks.length >= 3);
    expect(f.unblocks).toEqual(["9", "9", "9"]);
    u1();
    u2();
    ac.abort();
    f.release();
  });
});
