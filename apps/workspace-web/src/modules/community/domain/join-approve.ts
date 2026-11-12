// CR-130 · duyệt yêu cầu tham gia: chọn «Tạo đối tác mới» hoặc «Gắn với đối tác có sẵn» (đối tác SHT). Thuần, không I/O.
export type Party = { party: string; name: string };
/** Trần của `GET /partners/search` (contract `PartnerSearchQuerySchema`): danh sách đầy ⇒ gõ từ khoá thì hỏi máy chủ. */
export const PARTY_LIMIT = 50;

/** Bỏ dấu (dấu kết hợp U+0300–U+036F, đ/Đ U+0111/U+0110 ⇒ d) và hạ chữ thường — viết bằng mã ký tự, không chuỗi tiếng Việt. */
const fold = (s: string): string => {
  let out = "";
  for (const ch of s.normalize("NFD")) {
    const n = ch.codePointAt(0) ?? 0;
    if (n >= 0x300 && n <= 0x36f) continue;
    out += n === 0x111 || n === 0x110 ? "d" : ch;
  }
  return out.toLowerCase();
};

/** Lọc đối tác theo từ khoá (không phân biệt hoa thường/dấu), tối đa `limit` dòng. */
export function filterParties(list: readonly Party[], q: string, limit = 50): Party[] {
  const k = fold(q.trim());
  return list.filter((p) => !k || fold(p.name).includes(k)).slice(0, limit);
}

/** Khoá i18n câu hướng dẫn khi duyệt lỗi; null = không phải lỗi gắn đối tác (giữ xử lý cũ). */
export function approveErrorKey(e: unknown): string | null {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "PARTNER_ALREADY_LINKED") return "community.flows.join.errLinked";
  if (code === "PARTNER_NOT_FOUND") return "community.flows.join.errPartyGone";
  return null;
}
