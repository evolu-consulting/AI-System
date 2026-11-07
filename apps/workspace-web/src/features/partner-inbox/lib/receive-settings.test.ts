// CR-124 · q4 · cài đặt nhận: triệu đồng ⇄ đồng, kiểm thứ tự ngưỡng.
import { describe, expect, it } from "bun:test";
import { draftOf, settingsIssue, settingsOf } from "./receive-settings";

describe("cài đặt nhận HĐ đối tác", () => {
  it("đồng ⇄ triệu đồng, giữ người phụ trách (trống ⇒ null)", () => {
    const d = draftOf({
      important_min: 500_000_000,
      critical_min: 2_000_000_000,
      owner_user_id: null,
    });
    expect(d).toEqual({ importantM: 500, criticalM: 2000, owner: "" });
    expect(settingsOf({ ...d, importantM: 100, owner: "u1" })).toEqual({
      important_min: 100_000_000,
      critical_min: 2_000_000_000,
      owner_user_id: "u1",
    });
  });
  it("ngưỡng Rất quan trọng phải lớn hơn Quan trọng", () => {
    expect(settingsIssue({ importantM: 500, criticalM: 500, owner: "" })).toBe("order");
    expect(settingsIssue({ importantM: -1, criticalM: 500, owner: "" })).toBe("negative");
    expect(settingsIssue({ importantM: 500, criticalM: 2000, owner: "" })).toBeNull();
  });
});
