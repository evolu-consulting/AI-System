// ADM-FR-41 · Q2b · payload NOTIFY `quota_threshold` + LISTEN/dừng (plan M4 §5.2).
import { describe, expect, it } from "bun:test";
import type { Db } from "@ai/db";
import { parseThresholdPayload, startQuotaListener } from "./quotas.listener";

const T = "01900000-0000-7000-8000-000000000001";

describe("ADM-FR-41 · parseThresholdPayload", () => {
  it.each([
    ["x", null],
    ["{}", null],
    [JSON.stringify({ tenant_id: "abc" }), null],
    [JSON.stringify({ tenant_id: T, extra: 1 }), null],
    [JSON.stringify({ tenant_id: T }), T],
  ])("%s → %p", (p, want) => {
    expect(parseThresholdPayload(p)).toBe(want);
  });
});

describe("ADM-FR-41 · startQuotaListener", () => {
  it("LISTEN đúng kênh; dừng → UNLISTEN, payload sau đó bị bỏ qua", async () => {
    let handler: ((p: string) => void) | undefined;
    let channel = "";
    let unlistened = false;
    const db = {
      listen: async (ch: string, fn: (p: string) => void) => {
        channel = ch;
        handler = fn;
        return async () => {
          unlistened = true;
        };
      },
    } as unknown as Db;
    const stop = startQuotaListener({ db, now: () => new Date() }, { coalesceMs: 5 });
    await Promise.resolve();
    expect(channel).toBe("quota_threshold");
    handler?.("x"); // payload hỏng: không ném
    await stop();
    expect(unlistened).toBe(true);
    handler?.(JSON.stringify({ tenant_id: T })); // sau dừng: không hẹn giờ evaluator
  });
});
