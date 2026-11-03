// CR-112 · ADM-FR-79 · trạng thái + resume của wizard onboard.
import { describe, expect, it } from "bun:test";
import {
  isSkippable,
  nextStep,
  onboardAgainSearch,
  prevStep,
  resolveStep,
  stepStates,
  validateWizardSearch,
} from "./wizard";

describe("ADM-FR-79 · wizard", () => {
  it("chưa có công ty ⇒ bước 1 dù ?step= là gì, có công ty ⇒ resume đúng bước, tối thiểu bước 2", () => {
    expect(resolveStep({})).toBe("company");
    expect(resolveStep({ step: 3 })).toBe("company");
    expect(resolveStep({ tenant: "t1" })).toBe("apps");
    expect(resolveStep({ tenant: "t1", step: 1 })).toBe("apps");
    expect(resolveStep({ tenant: "t1", step: 3 })).toBe("people");
    expect(resolveStep({ tenant: "t1", step: 4 })).toBe("review");
  });

  it("Onboard lại mở bước 2 trên công ty có sẵn (AC4)", () => {
    expect(resolveStep(onboardAgainSearch("t1"))).toBe("apps");
  });

  it("bước 3 và 4 bỏ qua được, bước 1 và 2 thì không (AC2)", () => {
    expect(["company", "apps", "people", "review"].map((s) => isSkippable(s as never))).toEqual([
      false,
      false,
      true,
      true,
    ]);
  });

  it("tiến/lùi: bước cuối ⇒ null; không lùi về bước 1 khi công ty đã tạo", () => {
    expect(nextStep("company")).toBe("apps");
    expect(nextStep("people")).toBe("review");
    expect(nextStep("review")).toBeNull();
    expect(prevStep("apps")).toBeNull();
    expect(prevStep("people")).toBe("apps");
    expect(prevStep("review")).toBe("people");
  });

  it("stepStates: done trước, current, todo sau", () => {
    expect(stepStates("company")).toEqual(["current", "todo", "todo", "todo"]);
    expect(stepStates("people")).toEqual(["done", "done", "current", "todo"]);
  });

  it("validateWizardSearch: bỏ giá trị lạ", () => {
    expect(validateWizardSearch({ tenant: "abc", step: "3" })).toEqual({ tenant: "abc", step: 3 });
    expect(validateWizardSearch({ tenant: "", step: "9" })).toEqual({
      tenant: undefined,
      step: undefined,
    });
    expect(validateWizardSearch({ step: "x" }).step).toBeUndefined();
  });
});
