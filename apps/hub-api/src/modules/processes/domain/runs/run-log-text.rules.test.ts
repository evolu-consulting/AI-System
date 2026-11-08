// CR-121 · R-2 · unit: bảng ánh xạ mã lỗi → câu vi/en, mức nhật ký theo vai, trạng thái bước.
import { describe, expect, it } from "bun:test";
import { DECISION_REASONS } from "@ai/contracts/chat";
import {
  canViewRunDetail,
  executorName,
  friendlyError,
  logLevelOf,
  runStatusText,
  stepNote,
  stepStateOf,
  WAITING_REVIEW_TEXT,
} from "./run-log-text.rules";

describe("CR-125 G2 · một nhãn chờ duyệt", () => {
  it("trạng thái run, ghi chú bước đều dùng WAITING_REVIEW_TEXT", () => {
    const run = { status: "waiting_review", decisionReason: null, currentStageName: null };
    expect(runStatusText(run)).toEqual(WAITING_REVIEW_TEXT);
    const base = { name: "B", lastErrorCode: null, retryCount: 0 };
    expect(stepNote({ ...base, raw: "waiting_review" })).toEqual(WAITING_REVIEW_TEXT);
    expect(WAITING_REVIEW_TEXT.vi).toBe("Đang chờ người duyệt");
  });
});

describe("friendlyError", () => {
  it("mã đã biết ⇒ câu vi + en, không lộ mã", () => {
    const e = friendlyError("TIMEOUT", "Đọc hoá đơn");
    expect(e.vi).toContain("Đọc hoá đơn");
    expect(e.en).toContain("Đọc hoá đơn");
    expect(e.vi).not.toContain("TIMEOUT");
  });

  it("mã lạ / vắng ⇒ câu mặc định 'chưa chạy được, hệ thống đang thử lại'", () => {
    for (const code of ["WEIRD_CODE_9", null, undefined, ""])
      expect(friendlyError(code, "Ghi sổ")).toEqual({
        vi: "Bước Ghi sổ chưa chạy được, hệ thống đang thử lại.",
        en: "Step Ghi sổ could not run yet; the system is retrying.",
      });
  });

  it("không phân biệt hoa/thường (reason job viết thường, code job viết hoa)", () => {
    expect(friendlyError("timeout", "A")).toEqual(friendlyError("TIMEOUT", "A"));
  });

  it("mọi decision.reason đều có câu riêng hoặc rơi về mặc định hợp lệ (vi + en không rỗng, không chứa mã)", () => {
    for (const r of DECISION_REASONS) {
      const e = friendlyError(r, "B");
      expect(e.vi.length).toBeGreaterThan(5);
      expect(e.en.length).toBeGreaterThan(5);
      expect(e.vi).not.toContain(r);
    }
  });
});

describe("mức nhật ký theo vai", () => {
  it("mức nhật ký theo vai: chỉ platform_admin là debug", () => {
    expect(logLevelOf("platform_admin")).toBe("debug");
    expect(logLevelOf("tenant_admin")).toBe("basic");
    expect(logLevelOf("member")).toBe("basic");
  });
  it("chỉ admin được xem trang chi tiết", () => {
    expect(canViewRunDetail("tenant_admin")).toBe(true);
    expect(canViewRunDetail("platform_admin")).toBe(true);
    expect(canViewRunDetail("member")).toBe(false);
  });
});

describe("trạng thái bước", () => {
  it("map trạng thái engine ⇒ nghiệp vụ", () => {
    expect(stepStateOf("done", "t")).toBe("done");
    expect(stepStateOf("failed", "t")).toBe("error");
    expect(stepStateOf("needs_decision", "t")).toBe("needs_decision");
    expect(stepStateOf("skipped", null)).toBe("skipped");
    expect(stepStateOf("pending", null)).toBe("not_reached");
    expect(stepStateOf("waiting_review", "t")).toBe("running");
    expect(stepStateOf("cancelled", null)).toBe("not_reached");
    expect(stepStateOf("cancelled", "t")).toBe("cancelled");
  });
  it("ghi chú: bỏ qua / chờ duyệt / lỗi; bước xong không có ghi chú", () => {
    const base = { name: "B", lastErrorCode: null, retryCount: 0 };
    expect(stepNote({ ...base, raw: "skipped" })?.vi).toContain("rẽ nhánh");
    expect(stepNote({ ...base, raw: "waiting_review" })?.vi).toContain("duyệt");
    expect(stepNote({ ...base, raw: "failed", lastErrorCode: "TIMEOUT" })?.vi).toContain(
      "quá thời gian",
    );
    expect(stepNote({ ...base, raw: "done" })).toBeUndefined();
  });
  it("status run needs_decision nêu lý do; done thì không kèm bước", () => {
    const t = runStatusText({
      status: "needs_decision",
      decisionReason: "retry_exhausted",
      currentStageName: "Ghi sổ",
    });
    expect(t.vi).toContain("Cần người quyết định");
    expect(t.vi).toContain("Ghi sổ");
    expect(runStatusText({ status: "done", decisionReason: null, currentStageName: "X" }).vi).toBe(
      "Đã hoàn thành",
    );
  });
  it("tên executor: catalog nếu có, ngược lại nhãn theo loại", () => {
    expect(executorName("agent", "Hoá đơn", "Invoice")).toEqual({ vi: "Hoá đơn", en: "Invoice" });
    expect(executorName("wait_for", null, null).vi).toBe("Chờ N giờ");
  });
});
