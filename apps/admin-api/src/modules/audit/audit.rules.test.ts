// ADM-FR-51 · M4-R12 · auditRange (ngày VN) + cursor chuẩn tắc — bổ sung cho test acceptance R16–R19.
import { describe, expect, it } from "bun:test";
import { auditRange, decodeCursor, encodeCursor } from "./audit.rules";

const NOW = new Date("2026-10-03T20:00:00Z"); // = 2026-10-04 03:00 giờ VN

describe("ADM-FR-51 · auditRange", () => {
  it("vắng from/to → từ 00:00 VN của 29 ngày trước hôm nay VN, không chặn trên", () => {
    expect(auditRange({}, NOW)).toEqual({
      since: new Date("2026-09-04T17:00:00Z"),
      until: null,
    });
  });

  it("from/to → [from 00:00 VN, to+1 00:00 VN); chỉ to → lùi 29 ngày từ to", () => {
    expect(auditRange({ from: "2026-09-01", to: "2026-09-02" }, NOW)).toEqual({
      since: new Date("2026-08-31T17:00:00Z"),
      until: new Date("2026-09-02T17:00:00Z"),
    });
    expect(auditRange({ to: "2026-09-30" }, NOW)).toEqual({
      since: new Date("2026-08-31T17:00:00Z"),
      until: new Date("2026-09-30T17:00:00Z"),
    });
  });

  it("from > to → invalid", () => {
    expect(auditRange({ from: "2026-09-03", to: "2026-09-02" }, NOW)).toBe("invalid");
  });
});

describe("ADM-FR-51 · cursor", () => {
  it("không chuẩn tắc / vượt bigint / số 0 → null", () => {
    expect(decodeCursor(`${encodeCursor("12")}=`)).toBeNull();
    expect(decodeCursor(encodeCursor("9223372036854775808"))).toBeNull();
    expect(decodeCursor(encodeCursor("0"))).toBeNull();
    expect(decodeCursor(encodeCursor("9223372036854775807"))).toBe("9223372036854775807");
  });
});
