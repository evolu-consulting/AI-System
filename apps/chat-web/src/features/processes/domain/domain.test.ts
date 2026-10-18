// HUB-FR-143…145 · P-d1 · T11a · domain thuần của chat-web.
import { describe, expect, test } from "bun:test";
import { DATE_INPUT_INVALID_KEY, isIsoCalendarDate } from "./date-input";
import {
  type DecisionOptionName,
  decisionOptionKey,
  decisionOptionVariant,
} from "./decision-option";
import { reviewWaitVariant } from "./escalation";
import { expiryDays } from "./expiry";
import { describeStageWait, earliestWait } from "./stage-wait";
import { formatClock, formatWaitDate, formatWaitDateTime } from "./wait-format";

describe("describeStageWait", () => {
  const wait = { dueAt: "2026-03-01T02:00:00.000Z", timeZone: "Asia/Ho_Chi_Minh" };
  test("skipped thắng mọi thứ", () => {
    expect(describeStageWait({ status: "skipped", nextRetryAt: "x", wait })).toEqual({
      kind: "skipped",
    });
  });
  test("next_retry_at ⇒ retrying có nextAt, n tối thiểu 1", () => {
    expect(describeStageWait({ status: "waiting_timer", retryCount: 2, nextRetryAt: "t" })).toEqual(
      {
        kind: "retrying",
        n: 2,
        nextAt: "t",
      },
    );
    expect(describeStageWait({ status: "waiting_timer", nextRetryAt: "t" })).toEqual({
      kind: "retrying",
      n: 1,
      nextAt: "t",
    });
  });
  test("wait ⇒ waiting_date; waiting_timer trơn ⇒ waiting", () => {
    expect(describeStageWait({ status: "waiting_timer", wait })).toEqual({
      kind: "waiting_date",
      ...wait,
    });
    expect(describeStageWait({ status: "waiting_timer" })).toEqual({ kind: "waiting" });
  });
  test("running/queued có retryCount>0 ⇒ retrying không nextAt; còn lại none", () => {
    expect(describeStageWait({ status: "running", retryCount: 1 })).toEqual({
      kind: "retrying",
      n: 1,
    });
    expect(describeStageWait({ status: "queued", retryCount: 3 })).toEqual({
      kind: "retrying",
      n: 3,
    });
    expect(describeStageWait({ status: "running", retryCount: 0 })).toEqual({ kind: "none" });
    expect(describeStageWait({ status: "done", retryCount: 2 })).toEqual({ kind: "none" });
  });
});

describe("earliestWait", () => {
  test("chọn hẹn sớm nhất, bỏ stage không hẹn, rỗng ⇒ null", () => {
    const a = { status: "waiting_timer", wait: { dueAt: "2026-05-02T00:00:00Z", timeZone: "UTC" } };
    const b = {
      status: "waiting_timer",
      wait: { dueAt: "2026-05-01T00:00:00Z", timeZone: "Asia/Tokyo" },
    };
    expect(earliestWait([{ status: "done" }, a, b])).toEqual(b.wait);
    expect(earliestWait([{ status: "done" }])).toBeNull();
    expect(earliestWait([])).toBeNull();
  });
});

describe("wait-format", () => {
  const iso = "2026-03-01T02:30:00.000Z";
  test("FD7 vi/en theo múi giờ server", () => {
    expect(formatWaitDateTime(iso, "Asia/Ho_Chi_Minh", "vi")).toBe("01/03/2026 09:30");
    expect(formatWaitDateTime(iso, "Asia/Ho_Chi_Minh", "en")).toBe("2026-03-01 09:30");
    expect(formatWaitDate(iso, "Asia/Ho_Chi_Minh", "vi")).toBe("01/03/2026");
    expect(formatClock(iso, "Asia/Ho_Chi_Minh", "en")).toBe("09:30");
  });
  test("qua ngày theo múi giờ; nửa đêm là 00:00 không phải 24:00", () => {
    expect(formatWaitDateTime("2026-03-01T17:00:00Z", "Asia/Ho_Chi_Minh", "en")).toBe(
      "2026-03-02 00:00",
    );
  });
  test("múi giờ lạ ⇒ UTC; ISO hỏng ⇒ rỗng", () => {
    expect(formatWaitDateTime(iso, "Not/AZone", "en")).toBe("2026-03-01 02:30");
    expect(formatWaitDateTime("không-phải-ngày", "UTC", "en")).toBe("");
    expect(formatClock("", "UTC", "vi")).toBe("");
  });
});

describe("isIsoCalendarDate", () => {
  test("biên", () => {
    expect(isIsoCalendarDate("2026-02-28")).toBe(true);
    expect(isIsoCalendarDate("2028-02-29")).toBe(true);
    expect(isIsoCalendarDate("2026-02-29")).toBe(false);
    expect(isIsoCalendarDate("2026-02-30")).toBe(false);
    expect(isIsoCalendarDate("2026-13-01")).toBe(false);
    expect(isIsoCalendarDate("2026-1-1")).toBe(false);
    expect(isIsoCalendarDate("")).toBe(false);
    expect(DATE_INPUT_INVALID_KEY).toBe("process.inputs.err.date.invalid");
  });
});

describe("decisionOptionVariant", () => {
  const opts: DecisionOptionName[] = ["add_attempt", "use_current", "cancel"];
  test("mọi tổ hợp", () => {
    const got = (r: string) => opts.map((o) => decisionOptionVariant(r, o));
    expect(got("retry_exhausted")).toEqual(["retry_exhausted", "default", "default"]);
    expect(got("timer_invalid")).toEqual(["timer_invalid", "timer_invalid", "default"]);
    expect(got("redo_limit")).toEqual(["default", "default", "default"]);
  });
  test("khoá i18n", () => {
    expect(decisionOptionKey("retry_exhausted", "add_attempt")).toBe(
      "process.common.option.add_attempt_retry_exhausted",
    );
    expect(decisionOptionKey("timer_invalid", "use_current")).toBe(
      "process.common.option.use_current_timer_invalid",
    );
    expect(decisionOptionKey("agent_failed", "cancel")).toBe("process.common.option.cancel");
  });
});

describe("expiryDays / reviewWaitVariant", () => {
  test("expiryDays", () => {
    expect(expiryDays("2026-03-01T00:00:00Z", "2026-03-08T00:00:00Z")).toBe(7);
    expect(expiryDays("2026-03-01T00:00:00Z", null)).toBeNull();
    expect(expiryDays("x", "2026-03-08T00:00:00Z")).toBeNull();
  });
  test("reviewWaitVariant", () => {
    expect(reviewWaitVariant({})).toBe("plain");
    expect(reviewWaitVariant({ escalatedGroup: null })).toBe("plain");
    expect(reviewWaitVariant({ escalatedGroup: "g" })).toBe("escalated");
  });
});
