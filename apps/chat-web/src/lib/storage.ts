// C1 FE · localStorage an toàn: chế độ riêng tư / chặn site data làm accessor ném lỗi → coi như không có.

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ListableStore = Store & Pick<Storage, "key" | "length">;

/** Tiền tố khoá nháp ô nhập (`features/composer`); phiên kết thúc → xoá cả nhóm. */
export const DRAFT_KEY_PREFIX = "chat:draft:";

function store(): ListableStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readLocal(key: string, s: Store | null = store()): string | null {
  try {
    return s?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string, s: Store | null = store()): void {
  try {
    s?.setItem(key, value);
  } catch {
    // bỏ qua: không lưu được thì lần sau nhập lại
  }
}

export function removeLocal(key: string, s: Store | null = store()): void {
  try {
    s?.removeItem(key);
  } catch {
    // bỏ qua
  }
}

/** Xoá mọi khoá bắt đầu bằng `prefix` (gom khoá trước rồi xoá: `key(i)` đổi khi đang xoá). */
export function removeLocalByPrefix(prefix: string, s: ListableStore | null = store()): void {
  try {
    if (!s) return;
    const keys: string[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i);
      if (k?.startsWith(prefix)) keys.push(k);
    }
    for (const k of keys) s.removeItem(k);
  } catch {
    // bỏ qua
  }
}
