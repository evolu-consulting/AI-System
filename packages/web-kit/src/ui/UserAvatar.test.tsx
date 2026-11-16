// CR-179 · header, chân sidebar và menu điện thoại dùng CÙNG MỘT avatar: cùng màu nền, cùng chữ cái đầu, cỡ theo thang.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { Avatar } from "./kit/avatar";
import { USER_AVATAR_TONE, UserAvatar } from "./UserAvatar";

type El = ReactElement<Record<string, unknown>>;
const props = (name: string, size?: 24 | 32 | 40) =>
  (UserAvatar({ name, ...(size ? { size } : {}) }) as El).props;

describe("UserAvatar", () => {
  test("mọi cỡ cùng một lớp màu nền (màu chính nhạt)", () => {
    for (const size of [24, 32, 40] as const)
      expect(String(props("Lan Nguyễn", size).className)).toContain(USER_AVATAR_TONE);
    expect(USER_AVATAR_TONE).toBe("bg-accent text-primary");
  });
  test("bọc kit Avatar kiểu người; có ảnh ⇒ testid ảnh, không ⇒ chữ cái đầu", () => {
    expect((UserAvatar({ name: "Lan Nguyễn" }) as El).type).toBe(Avatar);
    expect(props("Lan Nguyễn")["data-testid"]).toBe("person-avatar-initials");
    const withImg = (UserAvatar({ name: "Lan", src: "data:x" }) as El).props;
    expect(withImg["data-testid"]).toBe("person-avatar-img");
  });
  test("header (UserChip) và sidebar/điện thoại (UserMenu) đều dùng UserAvatar, không tự vẽ avatar", () => {
    const chip = readFileSync(new URL("./UserChip.tsx", import.meta.url), "utf8");
    const menu = readFileSync(
      new URL(
        "../../../../apps/workspace-web/src/features/shell/components/UserMenu.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(chip).toContain("<UserAvatar");
    expect(menu).toContain("<UserAvatar");
    expect(menu).not.toContain("bg-act-soft");
  });
});
