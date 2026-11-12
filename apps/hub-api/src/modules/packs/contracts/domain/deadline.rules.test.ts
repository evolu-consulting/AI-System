// CR-127 K6 · BR-07: lịch tính lại hiệu lực theo ngày (thay HD4 chuông cứng) — luật thuần, múi giờ công ty.
import { describe, expect, it } from "bun:test";
import { type DueContract, effectOn, planReminder } from "./deadline.rules";
import { atLocal, localDate } from "./local-time.rules";

const VN = "Asia/Ho_Chi_Minh";
const base: DueContract = {
  id: "c1",
  status: "done",
  kind: "contract",
  outcome: null,
  startDate: null,
  endDate: "2026-12-31",
};

describe("effectOn / múi giờ", () => {
  it("ngày VN đổi lúc 17:00Z", () => {
    expect(localDate(new Date("2026-10-31T16:59:59Z"), VN)).toBe("2026-10-31");
    expect(localDate(new Date("2026-10-31T17:00:00Z"), VN)).toBe("2026-11-01");
    expect(atLocal("2026-11-01", "00:00", VN).toISOString()).toBe("2026-10-31T17:00:00.000Z");
  });
  it("expiring khi còn ≤ notice_days (mặc định 30), expired sau end, kết cục thắng; chưa DONE / phụ lục ⇒ null", () => {
    expect(effectOn(base, "2026-11-30")).toBe("active");
    expect(effectOn(base, "2026-12-01")).toBe("expiring");
    expect(effectOn({ ...base, noticeDays: 60 }, "2026-11-01")).toBe("expiring");
    expect(effectOn(base, "2027-01-01")).toBe("expired");
    expect(effectOn({ ...base, outcome: "renewed" }, "2027-01-01")).toBe("renewed");
    expect(effectOn({ ...base, outcome: "terminated" }, "2026-10-01")).toBe("terminated");
    expect(effectOn({ ...base, status: "draft" }, "2027-01-01")).toBeNull();
    expect(effectOn({ ...base, kind: "appendix" }, "2027-01-01")).toBeNull();
  });
});

describe("planReminder · việc tính lại kế tiếp", () => {
  it("đang active ⇒ lần tới = đầu ngày vào ngưỡng Sắp hết hạn (00:00 giờ VN)", () => {
    const p = planReminder(base, new Date("2026-10-01T03:00:00Z"), VN);
    expect(p.effect).toBe("active");
    expect(p.nextAt?.toISOString()).toBe("2026-11-30T17:00:00.000Z"); // 2026-12-01 00:00 VN
  });
  it("đang expiring ⇒ lần tới = đầu ngày sau hết hạn; notice_days của HĐ đổi ngưỡng", () => {
    const p = planReminder(base, new Date("2026-12-10T03:00:00Z"), VN);
    expect([p.effect, p.nextAt?.toISOString()]).toEqual(["expiring", "2026-12-31T17:00:00.000Z"]);
    const q = planReminder({ ...base, noticeDays: "10" }, new Date("2026-10-01T03:00:00Z"), VN);
    expect(q.nextAt?.toISOString()).toBe("2026-12-20T17:00:00.000Z");
  });
  it("chưa hiệu lực ⇒ lần tới = ngày bắt đầu; expired / kết cục cuối / chưa DONE ⇒ hết lịch", () => {
    const n = planReminder(
      { ...base, startDate: "2026-11-05" },
      new Date("2026-10-01T03:00:00Z"),
      VN,
    );
    expect([n.effect, n.nextAt?.toISOString()]).toEqual([
      "not_started",
      "2026-11-04T17:00:00.000Z",
    ]);
    const now = new Date("2027-01-05T03:00:00Z");
    expect(planReminder(base, now, VN)).toMatchObject({ effect: "expired", nextAt: null });
    expect(planReminder({ ...base, outcome: "renewed" }, now, VN)).toMatchObject({
      effect: "renewed",
      nextAt: null,
    });
    expect(planReminder({ ...base, status: "draft" }, now, VN)).toMatchObject({
      effect: null,
      nextAt: null,
    });
  });
});
