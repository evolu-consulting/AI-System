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

/** Mặc định mở/thu của mỗi nhóm CHỈ tính lần đầu thấy nhóm (có chưa đọc ⇒ mở): sau đó hết chưa đọc không tự thu. */
export const freezeDefaults = (
  prev: Readonly<Record<string, boolean>>,
  groups: readonly { key: string; unread: number }[],
): Record<string, boolean> => {
  const out: Record<string, boolean> = { ...prev };
  for (const g of groups) if (!(g.key in out)) out[g.key] = g.unread > 0;
  return out;
};

/** Nhóm đang mở? Chứa cuộc đang mở ⇒ luôn mở; đã chọn ⇒ theo lựa chọn; chưa ⇒ theo mặc định lúc tải đầu. */
export const isOpen = (
  m: OpenMap,
  key: string,
  initial: boolean | undefined,
  hasSelected: boolean,
): boolean => hasSelected || (m[key] ?? initial ?? false);

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
