// CR-105 · cột "Số bước" của danh sách quy trình: def thư viện chỉ đếm bước duyệt (khớp "Bước n" trên Sơ đồ), không đếm route/finalize.
import { describe, expect, test } from "bun:test";
import { listStepCount } from "./defs.map";

describe("listStepCount", () => {
  test("def thư viện: 2 bước duyệt + route + finalize (4 stage) ⇒ 2", () => {
    expect(listStepCount({ slot: "contracts.approval", stage_count: 4, slot_step_count: 2 })).toBe(
      2,
    );
  });
  test("def thư viện thêm một bước duyệt (5 stage) ⇒ 3", () => {
    expect(listStepCount({ slot: "contracts.approval", stage_count: 5, slot_step_count: 3 })).toBe(
      3,
    );
  });
  test("def thường (không khe) giữ tổng stage; khe không có bước duyệt ⇒ rơi về tổng stage", () => {
    expect(listStepCount({ slot: null, stage_count: 4, slot_step_count: 0 })).toBe(4);
    expect(listStepCount({ slot: "contracts.approval", stage_count: 2, slot_step_count: 0 })).toBe(
      2,
    );
  });
});
