// CR-187 BR-187-3 · Màu avatar cố định theo người (băm id), không đổi khi đổi tên. 10 cặp token `--avatar-N-bg/-fg` ở styles/tokens.css.
export const AVATAR_COLORS = 10;

/** FNV-1a 32 bit trên id ⇒ chỉ số 0..9. Cùng id ⇒ cùng màu. */
export function avatarColorIndex(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % AVATAR_COLORS;
}

/** Style nền + chữ theo id; không có id ⇒ undefined (giữ màu mặc định cũ). */
export function avatarColorStyle(
  id: string | null | undefined,
): { backgroundColor: string; color: string } | undefined {
  if (!id) return undefined;
  const n = avatarColorIndex(id) + 1;
  return { backgroundColor: `var(--avatar-${n}-bg)`, color: `var(--avatar-${n}-fg)` };
}
