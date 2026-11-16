// CR-179 · MỘT avatar «người đăng nhập» cho thanh trên, chân thanh bên và menu điện thoại: cùng chữ cái đầu, cùng ảnh (nếu có),
// cùng màu nền (màu chính nhạt = token accent + chữ primary), cỡ theo thang 24/32/40 của kit Avatar.
import type { ReactElement } from "react";
import { Avatar, type AvatarSize } from "./kit/avatar";
import { cn } from "./kit/cn";

/** Lớp màu dùng chung (test so header = sidebar). */
export const USER_AVATAR_TONE = "bg-accent text-primary";

export function UserAvatar({
  name,
  src,
  size = 32,
  className,
  testId,
}: {
  name: string;
  src?: string | null | undefined;
  size?: AvatarSize;
  className?: string;
  testId?: string;
}): ReactElement {
  return (
    <Avatar
      name={name}
      src={src}
      size={size}
      className={cn(USER_AVATAR_TONE, className)}
      data-testid={testId ?? (src ? "person-avatar-img" : "person-avatar-initials")}
    />
  );
}
