// CR-121 · R-3: luật thuần trang chi tiết lượt chạy.
import { describe, expect, it } from "bun:test";
import { ApiError } from "@/lib/http";
import {
  canRerunStepUi,
  controlErrorKey,
  formatDuration,
  hasDebugTab,
  isPackBoundError,
  nodeKindOf,
  runControls,
} from "./run-detail-view";

describe("nodeKindOf", () => {
  it("đang chạy ⇒ viền nhấp nháy + hạt sáng; cần quyết định ⇒ viền cảnh báo, không hạt", () => {
    expect(nodeKindOf("running")).toMatchObject({ pulse: "acc", particle: true });
    expect(nodeKindOf("needs_decision")).toMatchObject({ pulse: "warn", particle: false });
  });
  it("chưa tới / đã huỷ ⇒ không nhấp nháy, đoạn nối không tô", () => {
    for (const s of ["not_reached", "cancelled"] as const)
      expect(nodeKindOf(s)).toMatchObject({ pulse: null, particle: false, reached: false });
  });
  it("xong / lỗi / bỏ qua ⇒ đã tới, tông riêng", () => {
    expect(nodeKindOf("done").tone).toBe("ok");
    expect(nodeKindOf("error").tone).toBe("err");
    expect(nodeKindOf("skipped").tone).toBe("off");
  });
});

describe("runControls", () => {
  it("đang chạy: admin thấy Dừng, không thấy Chạy lại", () => {
    expect(runControls("running", "tenant_admin", false)).toEqual({
      canStop: true,
      canRerun: false,
    });
  });
  it("đã kết thúc: Chạy lại; gắn gói ⇒ ẩn; thành viên ⇒ không nút", () => {
    expect(runControls("failed", "platform_admin", false)).toEqual({
      canStop: false,
      canRerun: true,
    });
    expect(runControls("done", "platform_admin", true).canRerun).toBe(false);
    expect(runControls("running", "member", false)).toEqual({ canStop: false, canRerun: false });
  });
});

describe("canRerunStepUi", () => {
  it("chỉ platform_admin, bước lỗi/xong, lượt chưa dừng", () => {
    expect(canRerunStepUi("platform_admin", "failed", "failed")).toBe(true);
    expect(canRerunStepUi("platform_admin", "done", "done")).toBe(true);
    expect(canRerunStepUi("tenant_admin", "failed", "failed")).toBe(false);
    expect(canRerunStepUi("platform_admin", "cancelled", "done")).toBe(false);
    expect(canRerunStepUi("platform_admin", "running", "running")).toBe(false);
  });
});

describe("lỗi + tiện ích", () => {
  it("409 pack_bound ⇒ câu riêng; 409 khác ⇒ câu trạng thái", () => {
    const pack = new ApiError(409, "CONFLICT", "x", { pack_bound: true });
    expect(isPackBoundError(pack)).toBe(true);
    expect(controlErrorKey(pack)).toContain("packBound");
    expect(controlErrorKey(new ApiError(409, "CONFLICT", "x"))).toContain("err.state");
    expect(controlErrorKey(new Error("boom"))).toContain("err.generic");
  });
  it("tab Gỡ lỗi chỉ khi level=debug", () => {
    expect(hasDebugTab("debug")).toBe(true);
    expect(hasDebugTab("basic")).toBe(false);
  });
  it("formatDuration", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(12_000)).toBe("12s");
    expect(formatDuration(185_000)).toBe("3m 05s");
    expect(formatDuration(3_720_000)).toBe("1h 02m");
  });
});
