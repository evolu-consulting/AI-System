// CR-187 BR-187-1 · hộp «Đổi mật khẩu»: sai mật khẩu hiện tại ⇒ lỗi trong hộp (ô «hiện tại»); khớp ⇒ gọi API đúng một lần.
import { describe, expect, mock, test } from "bun:test";
import { ApiError } from "@ai/web-kit/http";
import { submitChangePassword } from "./change-password";

const ok = { current: "MatKhauCu-123", next: "MatKhauMoi-456!", confirm: "MatKhauMoi-456!" };
const portOf = (fn: (c: string, n: string) => Promise<void>) => ({
  changeOwnPassword: mock(fn),
});

describe("CR-187 · submitChangePassword", () => {
  test("hợp lệ ⇒ gọi API với (hiện tại, mới) và báo ok", async () => {
    const port = portOf(async () => {});
    expect(await submitChangePassword(port, ok)).toEqual({ ok: true });
    expect(port.changeOwnPassword).toHaveBeenCalledTimes(1);
    expect(port.changeOwnPassword).toHaveBeenCalledWith(ok.current, ok.next);
  });

  test("sai mật khẩu hiện tại (400 INVALID_CURRENT_PASSWORD) ⇒ lỗi ở ô hiện tại", async () => {
    const port = portOf(async () => {
      throw new ApiError(400, "INVALID_CURRENT_PASSWORD", "x");
    });
    const r = await submitChangePassword(port, ok);
    expect(r).toMatchObject({ ok: false, field: "current" });
    expect(!r.ok && r.message.key).toBe("contracts.gape.account.pw.wrong");
  });

  test("nhập lại không khớp / quá ngắn / trùng mật khẩu cũ ⇒ chặn, không gọi API", async () => {
    const port = portOf(async () => {});
    expect(await submitChangePassword(port, { ...ok, confirm: "khac" })).toMatchObject({
      field: "confirm",
    });
    expect(
      await submitChangePassword(port, { ...ok, next: "ngan", confirm: "ngan" }),
    ).toMatchObject({ field: "next" });
    expect(
      await submitChangePassword(port, { ...ok, next: ok.current, confirm: ok.current }),
    ).toMatchObject({ field: "next" });
    expect(await submitChangePassword(port, { ...ok, current: "" })).toMatchObject({
      field: "current",
    });
    expect(port.changeOwnPassword).not.toHaveBeenCalled();
  });

  test("lỗi khác (mạng) ⇒ lỗi chung của hộp", async () => {
    const port = portOf(async () => {
      throw new ApiError(0, "NETWORK_ERROR", "x");
    });
    expect(await submitChangePassword(port, ok)).toMatchObject({ ok: false, field: "form" });
  });
});
