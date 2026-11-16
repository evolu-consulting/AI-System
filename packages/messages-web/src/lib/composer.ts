// CR-178 · M2 · luật thuần của ô soạn: chèn emoji tại con trỏ, lấy tệp từ dán/kéo thả, danh sách «dùng gần đây».

/** Chèn `ins` thay vùng chọn [start,end]; cắt theo `max` ký tự. Trả chữ mới + vị trí con trỏ sau emoji (null nếu hết chỗ). */
export function insertAtCursor(
  text: string,
  start: number,
  end: number,
  ins: string,
  max: number,
): { text: string; caret: number } | null {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  const next = text.slice(0, s) + ins + text.slice(e);
  if (next.length > max) return null;
  return { text: next, caret: s + ins.length };
}

/** Phần của DataTransfer/ClipboardData mà hàm dưới cần (để test không cần DOM). */
export type TransferLike = {
  files?: ArrayLike<File> | null;
  types?: ArrayLike<string> | null;
  getData?: (type: string) => string;
};

const typesOf = (dt: TransferLike | null | undefined): string[] => Array.from(dt?.types ?? []);

/** Kéo có tệp (không phải kéo chữ/liên kết)? */
export const dragHasFiles = (dt: TransferLike | null | undefined): boolean =>
  typesOf(dt).includes("Files");

/** Tệp thả vào. */
export const droppedFiles = (dt: TransferLike | null | undefined): File[] =>
  Array.from(dt?.files ?? []);

/**
 * Tệp từ thao tác dán. Dán kèm chữ (vd chép ô Excel có cả ảnh lẫn chữ) ⇒ coi là dán chữ, trả rỗng;
 * ảnh chụp màn hình (không có chữ) ⇒ trả tệp.
 */
export function pastedFiles(dt: TransferLike | null | undefined): File[] {
  const files = Array.from(dt?.files ?? []);
  if (files.length === 0) return [];
  const hasText = typesOf(dt).includes("text/plain") && (dt?.getData?.("text/plain") ?? "") !== "";
  return hasText ? [] : files;
}

export const RECENT_MAX = 24;
const RECENT_KEY = "msg.emoji.recent";
const SKIN_KEY = "msg.emoji.skin";

/** Đưa `emoji` lên đầu, bỏ trùng, giữ tối đa `max`. */
export function pushRecent(list: readonly string[], emoji: string, max = RECENT_MAX): string[] {
  return [emoji, ...list.filter((x) => x !== emoji)].slice(0, max);
}

export function loadRecent(store: Pick<Storage, "getItem"> | null = safeStore()): string[] {
  try {
    const v: unknown = JSON.parse(store?.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

export function saveRecent(
  list: readonly string[],
  store: Pick<Storage, "setItem"> | null = safeStore(),
): void {
  try {
    store?.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* localStorage bị chặn: bỏ qua, ô vẫn dùng được */
  }
}

export const SKIN_TONES = [
  "none",
  "light",
  "medium-light",
  "medium",
  "medium-dark",
  "dark",
] as const;
export type SkinToneKey = (typeof SKIN_TONES)[number];

export function loadSkin(store: Pick<Storage, "getItem"> | null = safeStore()): SkinToneKey {
  try {
    const v = store?.getItem(SKIN_KEY);
    return SKIN_TONES.find((x) => x === v) ?? "none";
  } catch {
    return "none";
  }
}

export function saveSkin(
  tone: SkinToneKey,
  store: Pick<Storage, "setItem"> | null = safeStore(),
): void {
  try {
    store?.setItem(SKIN_KEY, tone);
  } catch {
    /* bỏ qua */
  }
}

function safeStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
