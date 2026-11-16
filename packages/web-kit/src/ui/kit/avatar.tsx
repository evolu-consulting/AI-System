// CR-177 · Avatar: người = tròn, công ty = vuông bo. Cỡ 24/32/40. Ảnh/chữ cái đầu như PersonAvatar.
import type { ComponentProps } from "react";
import { avatarInitials } from "../PersonAvatar";
import { cn } from "./cn";

export type AvatarSize = 24 | 32 | 40;
const SIZE: Record<AvatarSize, string> = {
  24: "size-6 text-[10px]",
  32: "size-8 text-xs",
  40: "size-10 text-sm",
};

export type AvatarProps = Omit<ComponentProps<"span">, "children"> & {
  name: string;
  src?: string | null | undefined;
  kind?: "person" | "company";
  size?: AvatarSize;
};

export function Avatar({
  name,
  src,
  kind = "person",
  size = 32,
  className,
  ...props
}: AvatarProps) {
  return (
    <span
      data-slot="avatar"
      data-kind={kind}
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden bg-primary font-semibold text-primary-foreground",
        SIZE[size],
        kind === "company" ? "rounded-[28%]" : "rounded-full",
        className,
      )}
      {...props}
    >
      {src ? (
        <img src={src} alt="" className="size-full object-cover" />
      ) : (
        <span aria-hidden="true">{avatarInitials(name)}</span>
      )}
    </span>
  );
}

export function AvatarGroup({
  people,
  max = 3,
  size = 32,
  className,
}: {
  people: AvatarProps[];
  max?: number;
  size?: AvatarSize;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span data-slot="avatar-group" className={cn("inline-flex items-center", className)}>
      {shown.map((p, i) => (
        <Avatar
          // biome-ignore lint/suspicious/noArrayIndexKey: danh sách tĩnh, tên có thể trùng
          key={`${p.name}-${i}`}
          size={size}
          {...p}
          className={cn("-ml-2 ring-2 ring-card first:ml-0", p.className)}
        />
      ))}
      {rest > 0 && (
        <span
          data-slot="avatar-more"
          className={cn(
            "-ml-2 inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-card",
            SIZE[size],
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
