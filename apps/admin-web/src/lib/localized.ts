// ADM-FR-20, ADM-FR-30 · chọn chuỗi theo ngôn ngữ đang dùng cho trường `{vi, en?}` (tên/mô tả feature, mô tả command).

export type LocalizedText = { vi: string; en?: string };

/** Ngôn ngữ đang dùng; thiếu bản dịch (hoặc rỗng) → rơi về `vi` (bắt buộc). */
export function pickLocalized(text: LocalizedText, lang: string): string {
  const en = text.en?.trim();
  return lang.startsWith("en") && en ? en : text.vi;
}
