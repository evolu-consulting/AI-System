import { describe, expect, test } from "bun:test";
import { activeStep, chipStates, dialogOpen, STEP_MS } from "./extract-progress";

describe("extract-progress (ux-excel E5)", () => {
  test("chip tiến theo thời gian và dừng ở chip cuối", () => {
    expect(activeStep(0)).toBe(0);
    expect(activeStep(STEP_MS - 1)).toBe(0);
    expect(activeStep(STEP_MS)).toBe(1);
    expect(activeStep(STEP_MS * 2)).toBe(2);
    expect(activeStep(STEP_MS * 50)).toBe(2);
    expect(activeStep(-5)).toBe(0);
  });
  test("trạng thái chip", () => {
    expect(chipStates(0)).toEqual(["active", "todo", "todo"]);
    expect(chipStates(2)).toEqual(["done", "done", "active"]);
  });
  test("hộp mở khi đang tải hoặc AI đang đọc, đóng khi xong/lỗi", () => {
    expect(dialogOpen({ uploading: true })).toBe(true);
    expect(dialogOpen({ uploading: false, extract: "reading" })).toBe(true);
    expect(dialogOpen({ uploading: false, extract: "ready" })).toBe(false);
    expect(dialogOpen({ uploading: false, extract: "failed" })).toBe(false);
  });
});
