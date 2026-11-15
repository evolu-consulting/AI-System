// CR-172 · MỘT chỗ hiện «ai đang đăng nhập» ở thanh trên mọi app: ảnh đại diện (CR-147/156) nếu có, không thì chữ cái đầu + tên.
// Ảnh lấy từ `/people/me` một lần cho cả phiên tab (lỗi ⇒ im lặng, rơi về chữ cái đầu).
import { type ReactElement, useEffect, useState } from "react";
import { api } from "../http";
import { PersonAvatar } from "./PersonAvatar";

let cached: Promise<string | null> | null = null;

function loadMyAvatar(): Promise<string | null> {
  cached ??= api<{ avatar: string | null }>("/people/me")
    .then((r) => r.avatar ?? null)
    .catch(() => {
      cached = null; // lần sau thử lại
      return null;
    });
  return cached;
}

/** Cho test / đổi người đăng nhập. */
export function resetUserChipCache(): void {
  cached = null;
}

export function UserChip({ name, className }: { name: string; className?: string }): ReactElement {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadMyAvatar().then((a) => live && setSrc(a));
    return () => {
      live = false;
    };
  }, []);
  return (
    <span
      data-testid="user-chip"
      className={className}
      style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0, margin: "0 4px" }}
    >
      <PersonAvatar name={name} src={src} size={28} />
      <span
        data-testid="user-chip-name"
        style={{
          fontSize: 13,
          fontWeight: 600,
          maxWidth: 160,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name}
      </span>
    </span>
  );
}
