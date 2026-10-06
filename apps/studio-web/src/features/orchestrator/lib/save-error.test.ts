import { describe, expect, it } from "bun:test";
import { ApiError } from "#/lib/http";
import { classifySaveError } from "./save-error";

const ref = (field?: string) =>
  new ApiError(400, "INVALID_REFERENCE", "x", field ? { field } : undefined);

describe("classifySaveError · INVALID_REFERENCE theo details.field", () => {
  it("field agent_id → lỗi ở ô agent (cả form mặc định)", () => {
    const f = classifySaveError(ref("agent_id"), { hasTenant: false });
    expect(f.errors).toEqual({ agent_id: "errors.INVALID_REFERENCE" });
    expect(f.toast).toBeUndefined();
  });
  it("field tenant_id + form có ô tenant → lỗi ở ô tenant", () => {
    const f = classifySaveError(ref("tenant_id"), { hasTenant: true });
    expect(f.errors).toEqual({ tenant_id: "errors.INVALID_REFERENCE" });
  });
  it("field tenant_id + form mặc định (không có ô tenant) → toast", () => {
    const f = classifySaveError(ref("tenant_id"), { hasTenant: false });
    expect(f.errors).toEqual({});
    expect(f.toast?.key).toBe("errors.INVALID_REFERENCE");
  });
  it("field lạ hoặc thiếu → toast", () => {
    expect(classifySaveError(ref("workflow_id"), { hasTenant: true }).toast).toBeDefined();
    expect(classifySaveError(ref(), { hasTenant: true }).errors).toEqual({});
  });
  it("ORCHESTRATOR_EXISTS ở form mặc định → toast, không gắn ô tenant vô hình", () => {
    const f = classifySaveError(new ApiError(409, "ORCHESTRATOR_EXISTS", "x"), {
      hasTenant: false,
    });
    expect(f.errors.tenant_id).toBeUndefined();
    expect(f.toast).toBeDefined();
  });
});
