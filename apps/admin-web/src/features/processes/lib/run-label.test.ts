import { describe, expect, test } from "bun:test";
import { recordLabel, recordLabelText } from "./run-label";

describe("run-label", () => {
  test("có nhãn ⇒ nhãn đã cắt khoảng trắng; không có/rỗng ⇒ null và —", () => {
    expect(recordLabel({ record_label: "  HD-2026-001 " })).toBe("HD-2026-001");
    expect(recordLabel({ record_label: " " })).toBeNull();
    expect(recordLabel({ record_label: null })).toBeNull();
    expect(recordLabel({})).toBeNull();
    expect(recordLabelText({ record_label: "HD-1" })).toBe("HD-1");
    expect(recordLabelText({})).toBe("—");
  });
});
