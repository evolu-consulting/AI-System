// CR-148 · nhớ nhóm phòng ban nào đang thu gọn TRONG PHIÊN (sessionStorage; đóng tab là quên). Mặc định mọi nhóm mở. Truy cập lỗi (chế độ riêng tư) ⇒ coi như không nhớ.
const KEY = "msg.dir.collapsed";

export function readCollapsed(storage: Pick<Storage, "getItem"> | undefined = safe()): Set<string> {
  try {
    const v = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeCollapsed(
  s: ReadonlySet<string>,
  storage: Pick<Storage, "setItem"> | undefined = safe(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify([...s]));
  } catch {
    /* không nhớ được cũng không sao */
  }
}

/** Bật/tắt một nhóm; trả tập mới (không sửa tập cũ). */
export function toggleCollapsed(s: ReadonlySet<string>, key: string): Set<string> {
  const n = new Set(s);
  if (!n.delete(key)) n.add(key);
  return n;
}

function safe(): Storage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}
