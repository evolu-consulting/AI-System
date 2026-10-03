// ADM-FR-42 · DateOnlySchema: ngày hỏng (tháng 13, 30/02) → lỗi validate, không ném RangeError (500).
import { describe, expect, it } from "bun:test";
import { DateOnlySchema } from "./quotas";

describe("ADM-FR-42 · DateOnlySchema", () => {
  it("nhận ngày có thật; từ chối tháng 13, 30/02, sai định dạng", () => {
    expect(DateOnlySchema.safeParse("2026-02-28").success).toBe(true);
    for (const v of ["2026-13-01", "2026-02-30", "2026-00-10", "2026-1-01"])
      expect(DateOnlySchema.safeParse(v).success).toBe(false);
  });
});
