// Demo · cờ đóng băng tắt ⇒ không dò `GET /processes` (không 404 trong console).
import { describe, expect, it } from "bun:test";
import { probeEngine } from "./api";

describe("probeEngine", () => {
  it("module đóng băng tắt ⇒ off, không gọi mạng", async () => {
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls++;
      return Promise.reject(new Error("không được gọi"));
    }) as unknown as typeof fetch;
    try {
      expect(await probeEngine()).toBe("off");
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = orig;
    }
  });
});
