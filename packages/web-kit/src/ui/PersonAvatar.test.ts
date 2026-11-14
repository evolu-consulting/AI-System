import { describe, expect, it } from "bun:test";
import { avatarInitials, avatarTestId } from "./PersonAvatar";

describe("avatarInitials [CR-147]", () => {
  it("một từ ⇒ 1 chữ; nhiều từ ⇒ từ đầu + từ cuối; rỗng ⇒ ?", () => {
    expect(avatarInitials("Lan")).toBe("L");
    expect(avatarInitials("  nguyễn văn an ")).toBe("NA");
    expect(avatarInitials("")).toBe("?");
  });
});

describe("avatarTestId [CR-147]", () => {
  it("có testId gốc ⇒ hậu tố -img / -initials theo trạng thái; không có ⇒ mặc định", () => {
    expect(avatarTestId("me-avatar", true)).toBe("me-avatar-img");
    expect(avatarTestId("me-avatar", false)).toBe("me-avatar-initials");
    expect(avatarTestId(undefined, false)).toBe("person-avatar-initials");
  });
});
