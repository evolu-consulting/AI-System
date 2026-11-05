// CR-118 · COM-FR-27 · nhớ trạng thái thu gọn/mở của ô đăng bản tin theo người dùng (localStorage; chặn/lỗi ⇒ dùng mặc định).
const key = (userId: string): string => `community.composer.open:${userId}`;

/** `true` = mở, `false` = thu gọn, `null` = chưa lưu / đọc lỗi (nơi gọi dùng mặc định). */
export function parseComposerOpen(raw: string | null): boolean | null {
  return raw === "1" ? true : raw === "0" ? false : null;
}

export function loadComposerOpen(userId: string): boolean | null {
  try {
    return parseComposerOpen(localStorage.getItem(key(userId)));
  } catch {
    return null;
  }
}

export function saveComposerOpen(userId: string, open: boolean): void {
  try {
    localStorage.setItem(key(userId), open ? "1" : "0");
  } catch {
    /* không lưu được: vẫn đổi trong phiên */
  }
}
