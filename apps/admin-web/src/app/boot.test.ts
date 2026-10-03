// ADM-NFR-06 · boot: thiếu bản dịch / init lỗi → onFail, đủ → onReady.
import { describe, expect, test } from "bun:test";
import { boot } from "./boot";

describe("boot", () => {
  test("đủ bản dịch → onReady", async () => {
    const calls: string[] = [];
    await boot(
      () => calls.push("ready"),
      () => calls.push("fail"),
      async () => undefined,
      () => true,
    );
    expect(calls).toEqual(["ready"]);
  });
  test("thiếu bản dịch → onFail", async () => {
    const calls: string[] = [];
    await boot(
      () => calls.push("ready"),
      () => calls.push("fail"),
      async () => undefined,
      () => false,
    );
    expect(calls).toEqual(["fail"]);
  });
  test("init ném lỗi → onFail (không unhandled rejection)", async () => {
    const calls: string[] = [];
    await boot(
      () => calls.push("ready"),
      () => calls.push("fail"),
      () => Promise.reject(new Error("x")),
      () => true,
    );
    expect(calls).toEqual(["fail"]);
  });
});
