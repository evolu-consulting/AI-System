import { describe, expect, test } from "bun:test";
import { partnerNameSchema, partnerUserSchema } from "./schemas";

const issue = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.error?.issues[0]?.message;

describe("ADM-FR-74 · form công ty đối tác", () => {
  test("tên 1..200 ký tự sau khi cắt khoảng trắng", () => {
    expect(partnerNameSchema.parse({ name: "  Acme Co  " }).name).toBe("Acme Co");
    expect(issue(partnerNameSchema.safeParse({ name: "   " }))).toBe("partners.error.nameRequired");
    expect(issue(partnerNameSchema.safeParse({ name: "x".repeat(201) }))).toBe(
      "partners.error.nameMax",
    );
    expect(partnerNameSchema.safeParse({ name: "x".repeat(200) }).success).toBe(true);
  });
});

describe("ADM-FR-75 · form tài khoản đối tác", () => {
  const base = { username: "Nam", display_name: "Nam Le", email: "", locale: "vi" as const };

  test("username hạ chữ thường; email trống được (không bắt buộc)", () => {
    expect(partnerUserSchema.parse(base).username).toBe("nam");
  });

  test("email sai định dạng bị từ chối; hợp lệ được nhận", () => {
    expect(issue(partnerUserSchema.safeParse({ ...base, email: "abc" }))).toBe(
      "users.error.emailFormat",
    );
    expect(partnerUserSchema.safeParse({ ...base, email: "a@b.co" }).success).toBe(true);
  });

  test("thiếu tên hiển thị / username sai định dạng", () => {
    expect(issue(partnerUserSchema.safeParse({ ...base, display_name: " " }))).toBe(
      "users.error.displayNameRequired",
    );
    expect(issue(partnerUserSchema.safeParse({ ...base, username: "a b" }))).toBe(
      "users.error.usernameFormat",
    );
  });
});
