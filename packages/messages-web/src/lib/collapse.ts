// CR-190 · nhớ nhóm nào người dùng đã mở/thu trên máy này (localStorage). Chưa từng chọn ⇒ theo mặc định: nhóm có tin chưa đọc mở sẵn, còn lại thu.
// Truy cập lỗi (chế độ riêng tư, bị chặn) ⇒ coi như không nhớ, không báo lỗi.
const KEY = "msg.dir.open.v1";

export type OpenMap = Readonly<Record<string, boolean>>;

export function readOpen(storage: Pick<Storage, "getItem"> | undefined = safe()): OpenMap {
  try {
    const v: unknown = JSON.parse(storage?.getItem(KEY) ?? "{}");
    if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
    const out: Record<string, boolean> = {};
    for (const [k, x] of Object.entries(v)) if (typeof x === "boolean") out[k] = x;
    return out;
  } catch {
    return {};
  }
}

export function writeOpen(
  m: OpenMap,
  storage: Pick<Storage, "setItem"> | undefined = safe(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify(m));
  } catch {
    /* không nhớ được cũng không sao */
  }
}

/** Nhóm đang mở? Đã chọn ⇒ theo lựa chọn; chưa ⇒ mở khi có tin chưa đọc. */
export const isOpen = (m: OpenMap, key: string, unread: number): boolean => m[key] ?? unread > 0;

/** Đặt mở/thu một nhóm; trả bản mới (không sửa bản cũ). */
export const setOpen = (m: OpenMap, key: string, open: boolean): OpenMap => ({
  ...m,
  [key]: open,
});

function safe(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
