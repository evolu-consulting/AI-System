// CHAT-AC-20 · đường dẫn hội thoại dạng chuỗi (cho `href`); điều hướng trong app dùng `to: "/c/$id"` có kiểu.
export function conversationPath(id: string): string {
  return `/c/${encodeURIComponent(id)}`;
}

/** `/c/<id>` → id; `/c/new` và đường khác → null. */
export function conversationIdOf(pathname: string): string | null {
  const m = /^\/c\/([^/]+)\/?$/.exec(pathname);
  const raw = m?.[1];
  if (!raw || raw === "new") return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** 2 chữ cái đầu của tên hiển thị (avatar chữ tắt). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** `/rooms/<id>` → id; đường khác → null. */
export function roomIdOf(pathname: string): string | null {
  const m = /^\/rooms\/([^/]+)\/?$/.exec(pathname);
  const raw = m?.[1];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
