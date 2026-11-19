// CR-185 · PersonAvatar — MỘT avatar người cho mọi nơi. Rê / focus / chạm ⇒ tooltip CHỈ có họ tên (không «Phụ trách», «Bên A»…).
// Trạng thái thể hiện bằng viền `ring` / dấu `badge` / chữ cạnh avatar, không đưa vào tooltip.
import type { ReactNode } from "react";
import { Avatar, type AvatarSize } from "./avatar";
import { cn } from "./cn";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
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
      colorId={id}
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

/** Số avatar chồng tối đa (RULES.md «Danh sách avatar»); người thứ 6 trở đi gộp vào «+N». */
export const AVATAR_GROUP_MAX = 5;
/** Danh sách thả xuống: nhiều hơn ngần này dòng ⇒ cuộn trong khung. */
export const AVATAR_LIST_SCROLL_AFTER = 8;

/** Tách người hiện chồng / phần dư «+N». Thuần, có test. */
export function splitAvatars<T>(people: T[], max = AVATAR_GROUP_MAX): { shown: T[]; rest: number } {
  const shown = people.slice(0, Math.max(0, max));
  return { shown, rest: people.length - shown.length };
}

export type AvatarListPerson = Omit<PersonAvatarProps, "size"> & {
  key?: string;
  /** Chức vụ, hiện dưới họ tên trong danh sách thả xuống. */
  jobTitle?: string | null | undefined;
};

export type PersonAvatarGroupProps = {
  people: AvatarListPerson[];
  max?: number;
  size?: AvatarSize;
  className?: string;
  /** false ⇒ chỉ vẽ chồng avatar, không bấm mở danh sách (mỗi avatar vẫn có tooltip họ tên). */
  list?: boolean;
  /** Nhãn nút mở danh sách (aria-label + tooltip). Mặc định: các họ tên nối bằng dấu phẩy. */
  label?: string;
  testId?: string;
};

const MORE_SIZE = (size: AvatarSize) =>
  size === 24 ? "size-6 text-[10px]" : size === 40 ? "size-10 text-sm" : "size-8 text-xs";

/** Khung danh sách (avatar, họ tên, chức vụ); > 8 dòng ⇒ cuộn. Tách riêng để test tĩnh được. */
export function AvatarListBody({ people }: { people: AvatarListPerson[] }) {
  const scroll = people.length > AVATAR_LIST_SCROLL_AFTER;
  return (
    <ul
      data-slot="avatar-list"
      data-scroll={scroll ? "true" : undefined}
      className={cn("flex flex-col gap-1", scroll && "max-h-80 overflow-y-auto overscroll-contain")}
    >
      {people.map((p, i) => (
        <li
          key={p.key ?? p.id ?? `${p.name}-${i}`}
          data-slot="avatar-list-row"
          data-person={p.id ?? undefined}
          className="flex min-h-11 items-center gap-2 rounded-md px-1"
        >
          <PersonAvatar name={p.name} id={p.id} src={p.src} size={32} interactive={false} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{p.name}</span>
            {p.jobTitle ? (
              <span className="block truncate text-xs text-muted-foreground">{p.jobTitle}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * «Danh sách avatar» — MỘT component cho nhóm người: tối đa `max` (5) avatar chồng nhau + «+N».
 * Bấm cả nhóm ⇒ danh sách thả xuống (avatar, họ tên, chức vụ), cuộn khi > 8; Esc đóng, trả focus về nút.
 * Vùng bấm tối thiểu 44px trên điện thoại.
 */
export function PersonAvatarGroup({
  people,
  max = AVATAR_GROUP_MAX,
  size = 32,
  className,
  list = true,
  label,
  testId,
}: PersonAvatarGroupProps) {
  const { shown, rest } = splitAvatars(people, max);
  const asList = list && people.length > 0;
  const stack = (
    <span data-slot="avatar-group" className="inline-flex items-center">
      {shown.map((p, i) => (
        <PersonAvatar
          key={p.key ?? p.id ?? `${p.name}-${i}`}
          size={size}
          name={p.name}
          id={p.id}
          src={p.src}
          ring={p.ring}
          badge={p.badge}
          testId={p.testId}
          interactive={!asList}
          className={cn("-ml-2 ring-card first:ml-0", p.className)}
        />
      ))}
      {rest > 0 && (
        <span
          data-slot="avatar-more"
          className={cn(
            "-ml-2 inline-flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground ring-2 ring-card",
            MORE_SIZE(size),
          )}
        >
          +{rest}
        </span>
      )}
    </span>
  );
  if (!asList) return <span className={cn("inline-flex items-center", className)}>{stack}</span>;
  const names = label ?? people.map((p) => p.name).join(", ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={names}
          title={names}
          data-testid={testId}
          data-slot="avatar-list-trigger"
          className={cn(
            "inline-flex min-h-11 min-w-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-0 sm:min-w-0",
            className,
          )}
        >
          {stack}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-2"
        data-testid={testId ? `${testId}-list` : undefined}
      >
        <AvatarListBody people={people} />
      </PopoverContent>
    </Popover>
  );
}
