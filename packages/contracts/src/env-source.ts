// TECH-DEBT #193 · `.env.example` ghi "trống = mặc định": chuỗi rỗng/chỉ khoảng trắng coi như biến vắng, trước khi zod parse.
// Biến bắt buộc rỗng ⇒ vẫn lỗi (vì thành vắng), thông báo nêu tên biến.

/** Bỏ mọi khoá có giá trị `undefined`, `""` hoặc chỉ khoảng trắng; giá trị còn lại giữ nguyên (không trim). */
export function dropEmptyEnv(source: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v.trim() !== "") out[k] = v;
  return out;
}
