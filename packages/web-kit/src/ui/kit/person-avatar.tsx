// CR-185 · PersonAvatar — MỘT avatar người cho mọi nơi. Rê / focus / chạm ⇒ tooltip CHỈ có họ tên (không «Phụ trách», «Bên A»…).
// Trạng thái thể hiện bằng viền `ring` / dấu `badge` / chữ cạnh avatar, không đưa vào tooltip.
import type { ReactNode } from "react";
import { Avatar, type AvatarSize } from "./avatar";
import { cn } from "./cn";
import { TouchTip } from "./touch-tip";

export type PersonAvatarProps = {
  /** Họ tên (tooltip + aria-label). */
  name: string;
  /** Mã người (để gắn `data-person`). */
  id?: string | null | undefined;
  src?: string | null | undefined;
  size?: AvatarSize;
  /** Lớp viền màu (vd `ring-act` Bên A, `ring-late` Bên B). */
  ring?: string | undefined;
  /** Dấu nhỏ ở góc dưới phải (vd ✓ đã ký). */
  badge?: ReactNode;
  /** false ⇒ chỉ vẽ avatar, không tooltip/focus: dùng khi avatar nằm trong nút/mục menu đã có tên bên cạnh. */
  interactive?: boolean;
  className?: string | undefined;
  testId?: string | undefined;
};

export function PersonAvatar({
  name,
  id,
  src,
  size = 32,
  ring,
  badge,
  interactive = true,
  className,
  testId,
}: PersonAvatarProps) {
  const face = (
    <Avatar
      name={name}
      src={src}
      size={size}
      aria-hidden={interactive ? true : undefined}
      className={cn(ring && `ring-2 ${ring}`)}
    />
  );
  if (!interactive) {
    return (
      <span
        data-person={id ?? undefined}
        data-testid={testId}
        className={cn("relative inline-flex shrink-0", className)}
      >
        {face}
        {badge}
      </span>
    );
  }
  return (
    <TouchTip tip={name} tap>
      <span
        // biome-ignore lint/a11y/noNoninteractiveTabindex: avatar cần focus bàn phím để hiện tooltip
        tabIndex={0}
        role="img"
        aria-label={name}
        data-person={id ?? undefined}
        data-testid={testId}
        className={cn(
          "relative inline-flex shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {face}
        {badge}
      </span>
    </TouchTip>
  );
}

export type PersonAvatarGroupProps = {
  people: (Omit<PersonAvatarProps, "size"> & { key?: string })[];
  max?: number;
  size?: AvatarSize;
  className?: string;
};

/** Nhóm người: tối đa `max` avatar chồng nhau + «+N». Mỗi avatar vẫn có tooltip họ tên riêng. */
export function PersonAvatarGroup({
  people,
  max = 3,
  size = 32,
  className,
}: PersonAvatarGroupProps) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  return (
    <span data-slot="avatar-group" className={cn("inline-flex items-center", className)}>
      {shown.map((p, i) => (
        <PersonAvatar
          key={p.key ?? p.id ?? `${p.name}-${i}`}
          size={size}
          {...p}
          className={cn("-ml-2 ring-card first:ml-0", p.className)}
        />
      ))}
      {rest > 0 && (
        <span
          data-slot="avatar-more"
          className={cn(
            "-ml-2 inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-card",
            size === 24 ? "size-6 text-[10px]" : size === 40 ? "size-10 text-sm" : "size-8 text-xs",
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
