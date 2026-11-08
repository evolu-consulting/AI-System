// CR-125 · c1 · ngày HIỂN THỊ theo giờ Việt Nam (Asia/Ho_Chi_Minh, UTC+7) của một mốc ISO. Dữ liệu (đầu ra node, DB) luôn giữ mốc đầy đủ;
// chỉ lúc hiển thị mới cắt ngày — cắt theo UTC làm mốc 00:00–07:00 giờ VN lệch sang ngày hôm trước.
const VN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Ho_Chi_Minh",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** `dd/mm/yyyy` theo giờ VN; không phải mốc hợp lệ ⇒ trả nguyên chuỗi. */
export function viDayOf(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? VN.format(new Date(t)) : iso;
}

/** Chuỗi có dạng mốc ISO đầy đủ (ngày + giờ) — để biết khi nào cần định dạng ngày hiển thị. */
export const isIsoInstant = (v: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
