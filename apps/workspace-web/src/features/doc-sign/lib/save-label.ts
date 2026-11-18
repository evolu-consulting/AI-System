// CR-182 · nhãn nút Lưu của màn ký: đầy đủ (máy tính) và gọn (điện thoại ≤ 640px, vd «Lưu · còn 1») — chỉ chọn khoá i18n, không gọi i18n.
export type SaveKeys = { full: string; short: string | undefined };

/** `mode` prep ⇒ «Lưu chỗ ký» (đã ngắn); sign còn chỗ chưa ký ⇒ «Lưu (còn n chỗ chưa ký)» + bản gọn; ký đủ ⇒ «Lưu». */
export function saveKeys(mode: "prep" | "sign", left: number): SaveKeys {
  if (mode === "prep") return { full: "savePlaces", short: undefined };
  if (left > 0) return { full: "saveLeft", short: "saveLeftShort" };
  return { full: "saveSign", short: undefined };
}
