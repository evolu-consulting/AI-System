// HUB-NFR-02 · `startLoop`: chạy theo nhịp, không chồng lượt, lỗi chỉ log, dừng hẳn khi `signal` abort (QW-A2).
import { describe, expect, it } from "bun:test";
import { logger } from "./logger";
import { startLoop } from "./loop";

describe("startLoop [HUB-NFR-02]", () => {
  it("HUB-NFR-02 · chạy lặp, lỗi một lượt không dừng vòng; abort → không chạy thêm", async () => {
    const ac = new AbortController();
    let n = 0;
    startLoop({
      name: "t",
      everyMs: 5,
      log: logger,
      signal: ac.signal,
      tick: async () => {
        n++;
        if (n === 1) throw new Error("lượt lỗi");
      },
    });
    await Bun.sleep(60);
    expect(n).toBeGreaterThanOrEqual(3);
    ac.abort();
    const stopped = n;
    await Bun.sleep(40);
    expect(n).toBe(stopped);
  });
});

describe("startLoop · không chồng lượt [HUB-NFR-02]", () => {
  it("HUB-NFR-02 · lượt trước chưa xong → bỏ nhịp (không chồng)", async () => {
    const ac = new AbortController();
    let running = 0;
    let maxRunning = 0;
    startLoop({
      name: "t",
      everyMs: 5,
      log: logger,
      signal: ac.signal,
      tick: async () => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await Bun.sleep(30);
        running--;
      },
    });
    await Bun.sleep(80);
    ac.abort();
    expect(maxRunning).toBe(1);
  });

  it("HUB-NFR-02 · signal đã abort → không khởi động", async () => {
    const ac = new AbortController();
    ac.abort();
    let n = 0;
    startLoop({
      name: "t",
      everyMs: 5,
      log: logger,
      signal: ac.signal,
      tick: async () => void n++,
    });
    await Bun.sleep(30);
    expect(n).toBe(0);
  });
});
