// ADM-FR-66 · P-a F5: mã giai đoạn gợi ý từ tên (tách khỏi def-form cho đủ giới hạn 400 dòng).
/** Mã giai đoạn gợi ý từ tên: bỏ dấu, chữ thường, `-`; trùng ⇒ thêm `-2`, `-3`… */
export function slugKey(name: string, taken: readonly string[]): string {
  const base =
    name
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/đ/gi, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 28) || "stage";
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}-${n}`;
  return key;
}
