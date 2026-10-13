// HUB-FR-67 · validate bản nháp profile + ánh xạ lỗi 400 `steps.<i>`.
import { describe, expect, test } from "bun:test";
import { blankStep, fieldError, hasErrors, stepsBody, validate } from "./profile-draft";

const ok = (over = {}) => ({ ...blankStep(), provider_key: "claude-sub", model: "m", ...over });

describe("profile-draft", () => {
  test("tên sai khi tạo, thiếu model và provider", () => {
    const e = validate({ key: "A", steps: [blankStep()] }, true);
    expect(e.key).toBe("models.err.key");
    expect(e.step[0]).toEqual({
      provider: "models.profile.err.provider",
      model: "models.profile.err.model",
    });
  });
  test("không bước ⇒ lỗi steps; hợp lệ ⇒ không lỗi; sửa không kiểm tên", () => {
    expect(validate({ key: "ab", steps: [] }, true).steps).toBe("models.profile.err.steps");
    expect(hasErrors(validate({ key: "", steps: [ok()] }, false))).toBe(false);
  });
  test("stepsBody giữ thứ tự bước, `on` theo thứ tự chuẩn", () => {
    const b = stepsBody({ key: "x", steps: [ok({ on: ["timeout", "error"] })] });
    expect(b[0]?.on).toEqual(["error", "timeout"]);
  });
  test("400 steps.<i> / INVALID_REFERENCE ⇒ lỗi Provider ở bước; KEY_TAKEN ⇒ tên", () => {
    const bad = "models.profile.err.providerBad";
    expect(
      fieldError({ code: "VALIDATION_ERROR", details: { issues: [{ path: ["steps", 2, "x"] }] } })
        ?.step[2]?.provider,
    ).toBe(bad);
    expect(
      fieldError({ code: "INVALID_REFERENCE", details: { field: "steps", index: 1 } })?.step[1]
        ?.provider,
    ).toBe(bad);
    expect(fieldError({ code: "KEY_TAKEN" })?.key).toBe("models.errors.keyTaken");
    expect(fieldError({ code: "NOT_FOUND" })).toBeNull();
  });
});
