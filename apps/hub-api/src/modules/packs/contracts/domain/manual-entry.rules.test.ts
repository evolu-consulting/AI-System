import { describe, expect, test } from "bun:test";
import { canReconcile, canStartManual, needsReconcile } from "./manual-entry.rules";

describe("CR-157 canStartManual", () => {
  test("draft + failed ⇒ ok", () =>
    expect(canStartManual({ status: "draft", extractState: "failed" })).toBe("ok"));
  test("AI đang đọc ⇒ busy", () =>
    expect(canStartManual({ status: "draft", extractState: "reading" })).toBe("busy"));
  test("đã đọc xong (ready) ⇒ không cho", () =>
    expect(canStartManual({ status: "draft", extractState: "ready" })).toBe("not_allowed"));
  test("không phải draft ⇒ không cho", () =>
    expect(canStartManual({ status: "processing", extractState: "failed" })).toBe("not_allowed"));
});

describe("CR-157 needsReconcile", () => {
  test("manual chưa đối chiếu ⇒ chặn", () =>
    expect(needsReconcile({ entrySource: "manual", reconciledAt: null })).toBe(true));
  test("manual đã đối chiếu ⇒ qua", () =>
    expect(needsReconcile({ entrySource: "manual", reconciledAt: "2026-11-14T01:00:00Z" })).toBe(
      false,
    ));
  test("HĐ do AI đọc ⇒ không cần", () =>
    expect(needsReconcile({ entrySource: "ai", reconciledAt: null })).toBe(false));
});

describe("CR-157 canReconcile", () => {
  const f = { entrySource: "manual", status: "draft", createdBy: "u1", ownerId: "u2" };
  test("người tạo ⇒ ok", () => expect(canReconcile(f, "u1")).toBe("ok"));
  test("người được giao, không phải người tạo ⇒ ok", () =>
    expect(canReconcile(f, "u2")).toBe("ok"));
  test("người khác ⇒ forbidden", () => expect(canReconcile(f, "u3")).toBe("forbidden"));
  test("HĐ không phải nhập tay ⇒ not_manual", () =>
    expect(canReconcile({ ...f, entrySource: "ai" }, "u1")).toBe("not_manual"));
});
