import { describe, expect, test } from "bun:test";
import { UserCreateRequestSchema, UsernameSchema } from "@ai/contracts";
import { emailToValue, userCreateSchema, userEditSchema } from "./schemas";

const valid = {
  username: "nam",
  display_name: "Nam Le",
  email: "",
  role: "member" as const,
  locale: "vi" as const,
};

describe("ADM-FR-63 · schema form user khớp contract", () => {
  test("tên đăng nhập: FE hợp lệ ⇔ contract hợp lệ", () => {
    for (const username of ["a", "an", "an.b_c-1", "AN", "a b", "đ", "x".repeat(33)]) {
      expect(userCreateSchema.safeParse({ ...valid, username }).success).toBe(
        UsernameSchema.safeParse(username).success,
      );
    }
  });

  test("dữ liệu hợp lệ của FE được contract nhận", () => {
    const v = userCreateSchema.parse(valid);
    const body = {
      username: v.username,
      display_name: v.display_name,
      email: emailToValue(v.email),
      role: v.role,
      locale: v.locale,
    };
    expect(UserCreateRequestSchema.safeParse(body).success).toBe(true);
  });

  test("tenant_admin thiếu email → lỗi ở ô email; member không cần email", () => {
    const r = userCreateSchema.safeParse({ ...valid, role: "tenant_admin" });
    expect(r.error?.issues[0]).toMatchObject({
      path: ["email"],
      message: "users.error.emailRequired",
    });
    expect(userCreateSchema.safeParse(valid).success).toBe(true);
  });

  test("email sai định dạng bị chặn; tên hiển thị bắt buộc và tối đa 64", () => {
    const msg = (over: object) => userEditSchema.safeParse({ ...valid, ...over }).error?.issues[0];
    expect(msg({ email: "abc" })?.message).toBe("users.error.emailFormat");
    expect(msg({ display_name: " " })?.message).toBe("users.error.displayNameRequired");
    expect(msg({ display_name: "x".repeat(65) })?.message).toBe("users.error.displayNameMax");
  });

  test("emailToValue: trống → null", () => {
    expect(emailToValue(" ")).toBeNull();
    expect(emailToValue(" a@b.co ")).toBe("a@b.co");
  });
});
