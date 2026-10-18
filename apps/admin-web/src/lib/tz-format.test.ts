// ADM-FR-72 · P-d1 · nhãn lệch UTC + lựa chọn múi giờ (dời từ features/processes — dùng chung với tenants).
import { describe, expect, it } from "bun:test";
import { timeZoneOptions, utcOffsetLabel } from "./tz-format";

describe("tz-format", () => {
  const at = "2026-06-01T00:00:00Z";
  it("utcOffsetLabel", () => {
    expect(utcOffsetLabel("Asia/Ho_Chi_Minh", at)).toBe("UTC+07:00");
    expect(utcOffsetLabel("UTC", at)).toBe("UTC+00:00");
    expect(utcOffsetLabel("America/New_York", at)).toBe("UTC-04:00");
    expect(utcOffsetLabel("America/New_York", "2026-01-15T00:00:00Z")).toBe("UTC-05:00");
    expect(utcOffsetLabel("Asia/Kolkata", at)).toBe("UTC+05:30");
  });
  it("múi giờ lạ / thời điểm hỏng ⇒ rỗng", () => {
    expect(utcOffsetLabel("Not/AZone", at)).toBe("");
    expect(utcOffsetLabel("UTC", "x")).toBe("");
  });
  it("timeZoneOptions", () => {
    expect(timeZoneOptions(["Asia/Tokyo", "Not/AZone"], at)).toEqual([
      { id: "Asia/Tokyo", label: "Asia/Tokyo", hint: "UTC+09:00" },
      { id: "Not/AZone", label: "Not/AZone", hint: "" },
    ]);
  });
});
