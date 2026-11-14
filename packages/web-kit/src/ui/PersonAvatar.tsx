// CR-147b · MỘT avatar người dùng cho mọi nơi có tên người (hồ sơ, thanh trên; bảng tin/tin nhắn/việc của tôi gắn ở lát sau).
// Có ảnh (data URL do người dùng tự đổi) ⇒ vẽ ảnh tròn; chưa có ⇒ chữ cái đầu của tên (như trước đây).
import type { CSSProperties } from "react";

/** Chữ cái đầu: tối đa 2 ký tự (từ đầu + từ cuối), in hoa; tên rỗng ⇒ "?". */
export function avatarInitials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (w.length === 0) return "?";
  const first = [...(w[0] as string)][0] ?? "?";
  const last = w.length > 1 ? ([...(w[w.length - 1] as string)][0] ?? "") : "";
  return (first + last).toLocaleUpperCase("vi");
}

/** testId của avatar: có `base` ⇒ `<base>-img` (có ảnh) hoặc `<base>-initials` (chữ cái đầu) để test/e2e phân biệt hai trạng thái. */
export function avatarTestId(base: string | undefined, hasImage: boolean): string {
  const kind = hasImage ? "img" : "initials";
  return base ? `${base}-${kind}` : `person-avatar-${kind}`;
}

export function PersonAvatar({
  name,
  src,
  size = 32,
  className,
  testId,
}: {
  name: string;
  src?: string | null | undefined;
  size?: number;
  className?: string;
  testId?: string;
}) {
  const box: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    flex: "none",
    overflow: "hidden",
  };
  if (src)
    return (
      <img
        src={src}
        alt={name}
        data-testid={avatarTestId(testId, true)}
        className={className}
        style={{ ...box, objectFit: "cover", display: "block" }}
      />
    );
  return (
    <span
      role="img"
      aria-label={name}
      data-testid={avatarTestId(testId, false)}
      className={className}
      style={{
        ...box,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--cm-accent, #4f46e5)",
        color: "#fff",
        fontSize: Math.max(10, Math.round(size * 0.4)),
        fontWeight: 600,
      }}
    >
      {avatarInitials(name)}
    </span>
  );
}
