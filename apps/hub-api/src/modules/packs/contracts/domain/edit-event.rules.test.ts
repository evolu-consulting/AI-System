// HD-FR-06 · D-T9b: event `field_edited` luôn ≤ 64 KiB — chuỗi dài cắt theo điểm mã, số/bool/null giữ.
import { describe, expect, it } from "bun:test";
import { EVENT_TEXT_MAX, editEventData } from "./edit-event.rules";
import { CONTRACT_FIELD_KEYS } from "./fields.rules";

describe("editEventData", () => {
  it("giữ giá trị ngắn, số, bool, null", () => {
    const c = [
      { key: "notice_days" as const, old: 1, new: null },
      { key: "number" as const, old: "a", new: true },
    ];
    expect(editEventData(c)).toEqual({ changes: c });
  });
  it("cắt chuỗi dài theo điểm mã, không tách surrogate", () => {
    const long = "😀".repeat(EVENT_TEXT_MAX + 5);
    const [x] = editEventData([{ key: "penalty", old: long, new: "b" }]).changes;
    expect(x?.old).toBe(`${"😀".repeat(EVENT_TEXT_MAX)}…`);
  });
  it("23 khoá × 2000 ký tự (cả ký tự thoát JSON) ⇒ < 65536 byte", () => {
    const worst = "\u0001".repeat(2000);
    const data = editEventData(
      CONTRACT_FIELD_KEYS.map((key) => ({ key, old: worst, new: `ệ${"ể".repeat(1999)}` })),
    );
    expect(new TextEncoder().encode(JSON.stringify(data)).length).toBeLessThan(65536);
  });
});
