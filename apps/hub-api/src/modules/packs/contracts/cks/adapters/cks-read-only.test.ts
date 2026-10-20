// V2-H · cờ ghi CKS nhớ theo tenant (Q4): một lượt đọc mỗi tenant trong TTL, đọc lại khi hết hạn, lỗi không bị nhớ.
import { describe, expect, it } from "bun:test";
import { cachedFlag } from "./cks-read-only";

describe("V2-H · cachedFlag", () => {
  it("nhớ trong TTL theo tenant; hết TTL ⇒ đọc lại; lỗi ⇒ lần sau đọc lại", async () => {
    let t = 0;
    const calls: string[] = [];
    let fail = false;
    const flag = cachedFlag(
      async (tid) => {
        calls.push(tid);
        if (fail) throw new Error("db");
        return tid === "legacy";
      },
      () => t,
      1000,
    );
    expect(await Promise.all([flag("legacy"), flag("legacy"), flag("v2")])).toEqual([
      true,
      true,
      false,
    ]);
    expect(calls).toEqual(["legacy", "v2"]);
    t = 1000;
    fail = true;
    await expect(flag("v2")).rejects.toThrow("db");
    fail = false;
    expect(await flag("v2")).toBe(false);
    expect(calls).toEqual(["legacy", "v2", "v2", "v2"]);
  });
});
