// CR-127 · E6 · luật thuần trigger lịch: N hiệu lực, khoá idempotent, ngày theo múi giờ, khớp `days` (R#12).
import { describe, expect, it } from "bun:test";
import { type FlowCandidate, planEvent } from "./match.rules";
import {
  isIsoDate,
  SCHEDULED_EVENTS,
  scheduleDaysMatch,
  scheduleDaysOf,
  scheduleEventId,
  todayIn,
  triggerParamIssue,
} from "./schedule.rules";

describe("CR-127 E6 · schedule.rules", () => {
  it("sự kiện lịch của manifest contracts", () => {
    expect(SCHEDULED_EVENTS.get("contract.expiring")?.app).toBe("contracts");
    expect(SCHEDULED_EVENTS.has("milestone.due")).toBe(true);
    expect(SCHEDULED_EVENTS.has("contract.submitted")).toBe(false);
  });

  it("N: tham số > mặc định manifest; ngoài khoảng ⇒ null; sự kiện thường ⇒ null", () => {
    expect(scheduleDaysOf("contract.expiring", { days: 10 })).toBe(10);
    expect(scheduleDaysOf("contract.expiring", { days: "45" })).toBe(45);
    expect(scheduleDaysOf("contract.expiring", undefined)).toBe(30);
    expect(scheduleDaysOf("milestone.due", { days: null })).toBe(3);
    expect(scheduleDaysOf("contract.expiring", { days: 0 })).toBeNull();
    expect(scheduleDaysOf("contract.expiring", { days: 366 })).toBeNull();
    expect(scheduleDaysOf("contract.expiring", { days: 1.5 })).toBeNull();
    expect(scheduleDaysOf("contract.submitted", { days: 10 })).toBeNull();
  });

  it("khoá idempotent gồm sự kiện, bản ghi, mốc ngày, N", () => {
    expect(scheduleEventId("milestone.due", "r1", "2026-12-01", 3)).toBe(
      "milestone.due:r1:2026-12-01:3",
    );
  });

  it("hôm nay theo múi giờ công ty; múi sai ⇒ UTC", () => {
    const at = new Date("2026-11-10T20:00:00Z");
    expect(todayIn("Asia/Ho_Chi_Minh", at)).toBe("2026-11-11");
    expect(todayIn("UTC", at)).toBe("2026-11-10");
    expect(todayIn("Not/AZone", at)).toBe("2026-11-10");
    expect(isIsoDate("2026-11-10")).toBe(true);
    expect(isIsoDate("10/11/2026")).toBe(false);
  });

  it("R#12 · flow N chỉ khớp facts.days = N; facts không có days ⇒ không lọc", () => {
    expect(scheduleDaysMatch(30, 30)).toBe(true);
    expect(scheduleDaysMatch(30, 10)).toBe(false);
    expect(scheduleDaysMatch(30, undefined)).toBe(true);
    expect(scheduleDaysMatch(null, 10)).toBe(true);
  });

  it("planEvent: hai flow cùng sự kiện khác N ⇒ chỉ flow đúng N chạy", () => {
    const c = (id: string, days: number, position: number): FlowCandidate => ({
      companyFlowId: id,
      flowId: id,
      defKey: id,
      position,
      when: null,
      days,
    });
    const cands = [c("f30", 30, 0), c("f10", 10, 1)];
    expect(planEvent(cands, { days: 10 }, true).run.map((x) => x.companyFlowId)).toEqual(["f10"]);
    expect(planEvent(cands, { days: 30 }, true).run.map((x) => x.companyFlowId)).toEqual(["f30"]);
  });
});

describe("CR-127 E6b · triggerParamIssue (luật lưu)", () => {
  it("N trong khoảng / vắng / sự kiện không theo lịch ⇒ không lỗi", () => {
    expect(triggerParamIssue({ event: "milestone.due", params: { days: 3 } })).toBeNull();
    expect(triggerParamIssue({ event: "milestone.due" })).toBeNull();
    expect(triggerParamIssue({ event: "contract.signed", params: { days: 999 } })).toBeNull();
    expect(triggerParamIssue(null)).toBeNull();
  });
  it("N ngoài khoảng manifest / không nguyên ⇒ lỗi kèm path + khoảng", () => {
    const want = { path: ["trigger", "params", "days"], min: 1, max: 365 };
    expect(triggerParamIssue({ event: "milestone.due", params: { days: 0 } })).toEqual(want);
    expect(triggerParamIssue({ event: "contract.expiring", params: { days: 366 } })).toEqual(want);
    expect(triggerParamIssue({ event: "milestone.due", params: { days: 2.5 } })).toEqual(want);
  });
});
