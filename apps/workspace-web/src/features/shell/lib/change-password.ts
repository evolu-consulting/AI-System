// CR-187 BR-187-1 · «Đổi mật khẩu» tại chỗ: kiểm trước khi gửi + đổi lỗi API thành câu gắn đúng ô. Logic thuần (test không cần DOM).
// Luật độ mạnh dùng chung `@ai/web-kit/password-strength` (như Admin); độ dài/khớp dùng lại `newPasswordError` của platform/auth.
import { ApiError } from "@ai/web-kit/http";
import { type AuthPort, errorOf, type LoginMessage, newPasswordError } from "~/platform/auth";

export type PwField = "current" | "next" | "confirm" | "form";
export type PwResult = { ok: true } | { ok: false; field: PwField; message: LoginMessage };

const K = (key: string): LoginMessage => ({ key: `contracts.gape.account.pw.${key}` });

export async function submitChangePassword(
  port: Pick<AuthPort, "changeOwnPassword">,
  v: { current: string; next: string; confirm: string },
): Promise<PwResult> {
  if (!v.current) return { ok: false, field: "current", message: K("needCurrent") };
  const bad = newPasswordError(v.next, v.confirm);
  if (bad)
    return {
      ok: false,
      field: bad.key.endsWith("passwordMismatch") ? "confirm" : "next",
      message: bad,
    };
  if (v.next === v.current) return { ok: false, field: "next", message: K("same") };
  try {
    await port.changeOwnPassword(v.current, v.next);
    return { ok: true };
  } catch (err) {
    const code = err instanceof ApiError ? String(err.code) : "";
    if (code === "INVALID_CURRENT_PASSWORD")
      return { ok: false, field: "current", message: K("wrong") };
    if (code === "PASSWORD_UNCHANGED") return { ok: false, field: "next", message: K("same") };
    return { ok: false, field: "form", message: errorOf(err, "change") };
  }
}
