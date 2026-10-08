// X2b B3 · hook `onClosed` không ném (lỗi đồng bộ → log), vắng = không làm gì.
import { describe, expect, it } from "bun:test";
import type { Logger } from "../../../lib/logger";
import { notifyClosed } from "./sse-writer";

const logs: string[] = [];
const log = { error: (m: string) => logs.push(m) } as unknown as Logger;

describe("notifyClosed", () => {
  it("gọi hook với runId", () => {
    const got: string[] = [];
    notifyClosed({ log, onClosed: (id) => got.push(id) }, "r1");
    expect(got).toEqual(["r1"]);
  });
  it("vắng hook → không làm gì; hook ném → log, không ném", () => {
    expect(() => notifyClosed({ log }, "r1")).not.toThrow();
    const boom = () => {
      throw new Error("x");
    };
    expect(() => notifyClosed({ log, onClosed: boom }, "r2")).not.toThrow();
    expect(logs).toEqual(["run-on-closed-failed"]);
  });
});
