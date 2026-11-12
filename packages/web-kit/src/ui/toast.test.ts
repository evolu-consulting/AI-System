// CR-125 G3 · quy ước toast duy nhất: thành công và lỗi tự ẩn sau 3 giây (CR-134 Q11), lỗi có nút hành động ở lại tới khi bấm (audit #20).
import { describe, expect, mock, test } from "bun:test";

type Call = { kind: string; opts: Record<string, unknown> };
const calls: Call[] = [];
const rec =
  (kind: string) =>
  (_m: unknown, opts: Record<string, unknown> = {}) => {
    calls.push({ kind, opts });
    return calls.length;
  };
mock.module("sonner", () => ({
  toast: {
    success: rec("success"),
    error: rec("error"),
    info: rec("info"),
    warning: rec("warning"),
    message: rec("message"),
    dismiss: () => {},
  },
}));

import {
  ERROR_TOAST_MS,
  INFO_TOAST_MS,
  notifyBrief,
  notifyError,
  notifySuccess,
  SUCCESS_TOAST_MS,
  toast,
} from "./toast";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("toast", () => {
  test("ok → success 3s, late/error → 3s + nút đóng (CR-134 Q11)", async () => {
    calls.length = 0;
    await toast("Đã lưu");
    await toast("Lỗi", "late");
    await toast.error("Hỏng");
    expect(calls.map((c) => c.kind)).toEqual(["success", "error", "error"]);
    expect(calls[0]?.opts.duration).toBe(SUCCESS_TOAST_MS);
    for (const c of calls.slice(1)) {
      expect(c.opts.duration).toBe(ERROR_TOAST_MS);
      expect(c.opts.closeButton).toBe(true);
    }
    expect(ERROR_TOAST_MS).toBe(3000);
  });

  test("lỗi có nút hành động ở lại tới khi bấm (không mất nút sau 3s)", async () => {
    calls.length = 0;
    notifyError("Hỏng", { label: "Tải lại", onClick: () => {} });
    await flush();
    expect(calls[0]?.opts.duration).toBe(Number.POSITIVE_INFINITY);
    expect(calls[0]?.opts.closeButton).toBe(true);
  });

  test("tuỳ chọn gọi tường minh thắng mặc định; info 8s; brief tự đóng", async () => {
    calls.length = 0;
    await toast.error("x", { duration: 1000 });
    await toast.info("y");
    notifyBrief("z");
    notifyError("e");
    notifySuccess("s");
    await flush();
    expect(calls[0]?.opts.duration).toBe(1000);
    expect(calls[1]?.opts.duration).toBe(INFO_TOAST_MS);
    expect(calls.find((c) => c.opts.position === "top-center")?.opts.duration).toBe(
      SUCCESS_TOAST_MS,
    );
    expect(calls.filter((c) => c.kind === "error" && c.opts.closeButton === true)).toHaveLength(3);
  });
});
