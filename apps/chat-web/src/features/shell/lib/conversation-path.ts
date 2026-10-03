// CHAT-AC-20 · đường dẫn hội thoại. Route `/c/$id` do F8 thêm; đến lúc đó đường dẫn chưa có trong routeTree nên dùng chuỗi.
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
