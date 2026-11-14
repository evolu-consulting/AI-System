import { describe, expect, it } from "bun:test";
import { avatarInitials } from "./PersonAvatar";

describe("avatarInitials [CR-147]", () => {
  it("một từ ⇒ 1 chữ; nhiều từ ⇒ từ đầu + từ cuối; rỗng ⇒ ?", () => {
    expect(avatarInitials("Lan")).toBe("L");
    expect(avatarInitials("  nguyễn văn an ")).toBe("NA");
    expect(avatarInitials("")).toBe("?");
  });
});
