import { describe, expect, test } from "bun:test";
import { featureNodeByKey, MODULES } from "../modules";
import { newRealViolation, realActionAllowed, requiresApprovalBefore } from "./process-real-rule";
import { processDefStagePaths } from "./process-steps";

const n = (uid: string, step: number, after: string, real = false, node?: string) => ({
  uid,
  step,
  after,
  real,
  node,
});

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

describe("CR-125 m5 · tiền điều kiện do node khai báo (nguồn MODULES)", () => {
  test("Ký số khai requires.before = approval, hành vi như cũ qua khoá node", () => {
    expect(featureNodeByKey(MODULES, "contracts.esign")?.requires).toEqual({ before: "approval" });
    const auto = n("b", 0, "auto");
    const esign = n("k", 1, "auto", true, "contracts.esign");
    expect(newRealViolation([auto], [auto, esign])).toBe("k"); // picker / kéo thả / nối lại
    const ok = n("a", 0, "review");
    expect(newRealViolation([ok], [ok, esign])).toBeNull();
    expect(realActionAllowed([{ step: 0, after: "review", node: "contracts.esign" }], 0)).toBe(
      false,
    );
  });
  test("node có khai báo mà không có requires ⇒ không đòi gì (kể cả bước 0)", () => {
    expect(featureNodeByKey(MODULES, "community.show-post")?.requires).toBeUndefined();
    expect(requiresApprovalBefore("community.show-post")).toBe(false);
    expect(realActionAllowed([{ step: 0, after: "auto", node: "community.show-post" }], 0)).toBe(
      true,
    );
  });
  test("stage không node / node lạ giữ mặc định cũ (đòi người duyệt)", () => {
    expect(requiresApprovalBefore(undefined)).toBe(true);
    expect(requiresApprovalBefore("zzz.unknown")).toBe(true);
    expect(realActionAllowed([{ step: 0, after: "review", node: "zzz.unknown" }], 0)).toBe(false);
  });
  test("lưu (REAL_ACTION của Hub) đọc cùng khai báo: Ký số sau bước tự động ⇒ lỗi, node không đòi ⇒ không lỗi", () => {
    const st = (key: string, step: number, after: string, node?: string, real = false) => ({
      key,
      step,
      node,
      real_action: real,
      after: { kind: after },
    });
    const bad = processDefStagePaths([
      st("a", 0, "auto"),
      st("k", 1, "auto", "contracts.esign", true),
    ]);
    expect(bad).toContain("stages.1.real_action");
    const fine = processDefStagePaths([
      st("a", 0, "auto"),
      st("s", 1, "auto", "community.show-post", true),
    ]);
    expect(fine).not.toContain("stages.1.real_action");
    const good = processDefStagePaths([
      st("a", 0, "review"),
      st("k", 1, "auto", "contracts.esign", true),
    ]);
    expect(good).not.toContain("stages.1.real_action");
  });
});
