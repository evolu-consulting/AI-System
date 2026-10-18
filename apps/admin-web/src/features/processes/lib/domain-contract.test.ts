// HUB-FR-143…145, 115 · P-d1 · T11a · lớp 3 (CR-091/FD10): hằng domain web khai lại == hằng contract; hàm trùng == hàm contract.
import { describe, expect, test } from "bun:test";
import * as C from "@ai/contracts/chat";
import { isIsoCalendarDate } from "../domain/date-input";
import { decisionOptionVariant } from "../domain/decision-option";
import * as D from "../domain/limits";

describe("domain admin-web == contract", () => {
  test("hằng", () => {
    expect(D.STAGE_RETRY_MAX).toBe(C.STAGE_RETRY_MAX);
    expect(D.REMIND_EVERY_H).toEqual(C.REMIND_EVERY_H);
    expect(D.ESCALATE_AFTER_H).toEqual(C.ESCALATE_AFTER_H);
    expect(D.PROCESS_TTL_DAYS).toEqual(C.PROCESS_TTL_DAYS);
    expect(D.WAIT_OFFSET_DAYS).toEqual(C.WAIT_OFFSET_DAYS);
    expect(D.WAIT_TIME_RE.source).toBe(C.WAIT_TIME_RE.source);
    expect(D.ISO_DATE_RE.source).toBe(C.ISO_DATE_RE.source);
  });
  test("isIsoCalendarDate trùng contract", () => {
    for (const s of ["2026-02-28", "2026-02-30", "2028-02-29", "0099-01-01", "2026-13-01", "x", ""])
      expect(isIsoCalendarDate(s)).toBe(C.isIsoCalendarDate(s));
  });
  test("decisionOptionVariant chỉ nhận lý do/option có trong contract", () => {
    expect(C.DECISION_REASONS).toContain("retry_exhausted");
    expect(C.DECISION_REASONS).toContain("timer_invalid");
    for (const o of C.DECISION_OPTIONS)
      expect(typeof decisionOptionVariant("timer_invalid", o)).toBe("string");
  });
});
