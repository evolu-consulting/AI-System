// CR-122 · p22 · số bước tối đa hiệu lực: mặc định 22, kẹp 1…trần 50; schema quy trình nhận tới trần (server mới chặn theo cài đặt).
import { describe, expect, test } from "bun:test";
import {
  PROCESS_STAGES_CEILING,
  PROCESS_STAGES_DEFAULT,
  resolveStagesMax,
  SaveProcessLimitsRequestSchema,
  stagesMaxFromDetails,
} from "./processes";

describe("resolveStagesMax", () => {
  test("thiếu/sai ⇒ mặc định 22", () => {
    for (const v of [undefined, null, "30", 0, -1, 2.5, Number.NaN])
      expect(resolveStagesMax(v)).toBe(PROCESS_STAGES_DEFAULT);
    expect(PROCESS_STAGES_DEFAULT).toBe(22);
  });
  test("hợp lệ giữ nguyên, vượt trần bị kẹp 50", () => {
    expect(resolveStagesMax(5)).toBe(5);
    expect(resolveStagesMax(50)).toBe(50);
    expect(resolveStagesMax(999)).toBe(PROCESS_STAGES_CEILING);
  });
});

describe("SaveProcessLimitsRequest · stagesMaxFromDetails", () => {
  test("1…50 hợp lệ, 0 và 51 bị từ chối", () => {
    expect(SaveProcessLimitsRequestSchema.safeParse({ stages_max: 50 }).success).toBe(true);
    expect(SaveProcessLimitsRequestSchema.safeParse({ stages_max: 51 }).success).toBe(false);
    expect(SaveProcessLimitsRequestSchema.safeParse({ stages_max: 0 }).success).toBe(false);
  });
  test("đọc trần từ details lỗi", () => {
    expect(stagesMaxFromDetails({ paths: ["stages"], stages_max: 12 })).toBe(12);
    expect(stagesMaxFromDetails({ paths: ["stages"] })).toBeNull();
    expect(stagesMaxFromDetails(null)).toBeNull();
  });
});
