// Ngày giờ hiện tại theo múi tenant cho lời nhắc hệ thống của agent chat (thuần). Không có dòng này, model lấy "hôm nay" từ
// đồng hồ máy chạy CLI (UTC) ⇒ 0–7 giờ sáng giờ VN hỏi "hôm nay tôi đã hỏi gì" bị trả về ngày hôm qua (e2e deployed 08, 2026-10-23).

const WEEKDAY_VI = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

/** `2026-10-23 01:45 (Thứ Sáu), múi giờ Asia/Ho_Chi_Minh` — ngày/giờ/thứ theo lịch của `tz`. */
export function nowLine(now: Date, tz: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const date = `${p.year}-${p.month}-${p.day}`;
  const weekday = WEEKDAY_VI[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return (
    `Thời điểm hiện tại: ${date} ${p.hour}:${p.minute} (${weekday}), múi giờ ${tz}. ` +
    `Dùng mốc này khi người dùng nói "hôm nay", "hôm qua", "tuần này" (tham số ngày YYYY-MM-DD theo múi giờ này).`
  );
}

/** Nối dòng thời điểm vào cuối lời nhắc hệ thống; vượt trần ⇒ giữ nguyên lời nhắc. */
export function withNowLine(system: string, line: string, max: number): string {
  const text = system ? `${system}\n\n${line}` : line;
  return text.length > max ? system : text;
}
