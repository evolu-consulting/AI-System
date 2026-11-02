// COM-FR-29 · trạng thái xổ/gập từng nhóm Sidebar, nhớ trong localStorage (mọi truy cập bọc try/catch: bị chặn ⇒ vẫn chạy).
export const NAV_STATE_KEY = "community.nav.collapsed";

export function parseCollapsed(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function loadCollapsed(): string[] {
  try {
    return parseCollapsed(localStorage.getItem(NAV_STATE_KEY));
  } catch {
    return [];
  }
}

export function saveCollapsed(ids: string[]): void {
  try {
    localStorage.setItem(NAV_STATE_KEY, JSON.stringify(ids));
  } catch {
    /* không lưu được: vẫn đổi trong phiên */
  }
}

export const toggleCollapsed = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
