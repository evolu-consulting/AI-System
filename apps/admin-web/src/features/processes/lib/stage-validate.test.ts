// dlc-engine · hạn giai đoạn: bước DLC theo trần cứng của Hub (86 400 s), giai đoạn thường theo trần form.
import { describe, expect, test } from "bun:test";
import { emptyStage } from "./def-form";
import type { DraftErrors } from "./draft-types";
import { validateStage } from "./stage-validate";

const errs = (timeout: string, slotRaw?: Record<string, unknown>): DraftErrors => {
  const s = { ...emptyStage(0), name: "Build", key: "build", timeout, slotRaw };
  const e: DraftErrors = {};
  validateStage(s, 0, [s], e);
  return e;
};

describe("validateStage · hạn giai đoạn", () => {
  test("bước DLC chạy cả ngày (86 400 s) hợp lệ; quá trần cứng ⇒ lỗi", () => {
    expect(errs("86400", { kind: "dlc" })["stages.0.timeout_s"]).toBeUndefined();
    expect(errs("90000", { kind: "dlc" })["stages.0.timeout_s"]).toBe(
      "process.admin.validate.timeout",
    );
  });
  test("giai đoạn thường vẫn theo trần form", () => {
    expect(errs("14400")["stages.0.timeout_s"]).toBe("process.admin.validate.timeout");
    expect(errs("600")["stages.0.timeout_s"]).toBeUndefined();
  });
});
