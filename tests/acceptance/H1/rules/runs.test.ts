// HUB-FR-42 · HUB-NFR-02 · H1-R12, R13, R18 · luật thuần Run (test-plan H1 §4 R8–R10, test-plan-cases §1 R15a–d; plan §6.4).
import { describe, expect, it } from "bun:test";
import {
  eventsExpired,
  leaseExpired,
  parseLastEventId,
  queueTimeoutReason,
} from "../../../../apps/hub-api/src/modules/runs/runs.rules";

const NOW = new Date("2026-10-04T08:00:00.000Z");
const ago = (ms: number): Date => new Date(NOW.getTime() - ms);
const RETENTION_S = 600;

describe("R8 · eventsExpired [HUB-FR-42 · H1-R12]", () => {
  it("R8 · run running → false [HUB-FR-42]", () => {
    expect(eventsExpired({ status: "running", finishedAt: null }, NOW, RETENTION_S)).toBe(false);
  });

  it("R8 · xong 599 s trước → false [HUB-FR-42]", () => {
    expect(eventsExpired({ status: "finished", finishedAt: ago(599_000) }, NOW, RETENTION_S)).toBe(
      false,
    );
  });

  it("R8 · đúng 600 s → false (hết hạn khi > retention, Q-T5) [HUB-FR-42]", () => {
    expect(eventsExpired({ status: "failed", finishedAt: ago(600_000) }, NOW, RETENTION_S)).toBe(
      false,
    );
  });

  it("R8 · 600 s + 1 ms và 601 s → true [HUB-FR-42]", () => {
    expect(eventsExpired({ status: "finished", finishedAt: ago(600_001) }, NOW, RETENTION_S)).toBe(
      true,
    );
    expect(eventsExpired({ status: "cancelled", finishedAt: ago(601_000) }, NOW, RETENTION_S)).toBe(
      true,
    );
  });
});

describe("R9 · leaseExpired [HUB-NFR-02 · H1-R13]", () => {
  it("R9 · lease null → false (khớp sweeper SQL `<`) [H1-R13]", () => {
    expect(leaseExpired(null, NOW)).toBe(false);
  });

  it("R9 · lease = now − 1 ms → true [H1-R13]", () => {
    expect(leaseExpired(ago(1), NOW)).toBe(true);
  });

  it("R9 · lease == now → false [H1-R13]", () => {
    expect(leaseExpired(new Date(NOW.getTime()), NOW)).toBe(false);
  });
});

describe("R10 · queueTimeoutReason [H1-R18]", () => {
  it("R10 · tenant không giới hạn → provider_busy [H1-R18]", () => {
    expect(queueTimeoutReason({ tenantRunning: 5, tenantLimit: null })).toBe("provider_busy");
  });

  it("R10 · 0 < 1 → provider_busy [H1-R18]", () => {
    expect(queueTimeoutReason({ tenantRunning: 0, tenantLimit: 1 })).toBe("provider_busy");
  });

  it("R10 · 1 ≥ 1 và 3 ≥ 2 → tenant_slots [H1-R18]", () => {
    expect(queueTimeoutReason({ tenantRunning: 1, tenantLimit: 1 })).toBe("tenant_slots");
    expect(queueTimeoutReason({ tenantRunning: 3, tenantLimit: 2 })).toBe("tenant_slots");
  });
});

describe("R15 · parseLastEventId [HUB-FR-42 · H1-R12]", () => {
  it("R15a · header hoặc query, thiếu cả hai → 0 [HUB-FR-42 · H1-R12]", () => {
    expect(parseLastEventId("7", undefined)).toBe(7);
    expect(parseLastEventId(undefined, "5")).toBe(5);
    expect(parseLastEventId(undefined, undefined)).toBe(0);
    expect(parseLastEventId(null, null)).toBe(0);
  });

  it("R15b · header thắng; header sai không rơi về query [H1-R12]", () => {
    expect(parseLastEventId("7", "3")).toBe(7);
    expect(parseLastEventId("abc", "3")).toBe(0);
  });

  it("R15c · sai định dạng → 0 [H1-R12]", () => {
    for (const v of ["", "abc", "1.5", "1e3", " 4", "4-0", "0x10"]) {
      expect(parseLastEventId(v, undefined)).toBe(0);
    }
  });

  it("R15d · âm, 0, vượt MAX_SAFE_INTEGER → 0; đúng MAX_SAFE_INTEGER → giữ [H1-R12]", () => {
    expect(parseLastEventId("-1", undefined)).toBe(0);
    expect(parseLastEventId("0", undefined)).toBe(0);
    expect(parseLastEventId("9007199254740993", undefined)).toBe(0);
    expect(parseLastEventId("99999999999999999999", undefined)).toBe(0);
    expect(parseLastEventId("9007199254740991", undefined)).toBe(9007199254740991);
  });
});
