import { describe, expect, test } from "bun:test";
import { newRealViolation, realActionAllowed } from "./process-real-rule";

const n = (uid: string, step: number, after: string, real = false) => ({ uid, step, after, real });

describe("process-real-rule · Ký số cần bước duyệt ngay trước", () => {
  test("realActionAllowed: bước 0 không được; sau bước duyệt được; sau bước tự động không", () => {
    expect(realActionAllowed([{ step: 0, after: "review" }], 0)).toBe(false);
    expect(
      realActionAllowed(
        [
          { step: 0, after: "review" },
          { step: 1, after: "auto" },
        ],
        1,
      ),
    ).toBe(true);
    expect(
      realActionAllowed(
        [
          { step: 0, after: "auto" },
          { step: 1, after: "auto" },
        ],
        1,
      ),
    ).toBe(false);
    expect(
      realActionAllowed(
        [
          { step: 0, after: "review" },
          { step: 0, after: "auto" },
          { step: 1, after: "auto" },
        ],
        2,
      ),
    ).toBe(false);
  });
  test("newRealViolation: chỉ báo stage VỪA sai, không báo stage đã sai từ trước", () => {
    const a = n("a", 0, "review");
    const k = n("k", 1, "auto", true);
    expect(newRealViolation([a], [a, k])).toBeNull();
    const auto = n("b", 0, "auto");
    expect(newRealViolation([auto], [auto, k])).toBe("k");
    expect(newRealViolation([auto, k], [auto, k, n("z", 2, "auto")])).toBeNull();
  });
});
