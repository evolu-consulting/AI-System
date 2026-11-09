// CR-126 · «Vào app + email báo» · luật thuần (lớp 1): thư BÁO cho người nhận đã chọn khi bên nhận đã trên nền tảng. Chỉ báo + MỘT nút vào hộp thư
// đối tác trong app (đăng nhập mới xem/trả lời) — KHÔNG đính hợp đồng, KHÔNG đường dẫn trả lời không cần đăng nhập. Không I/O. Cùng kiểu thư với
// đường email đối tác (thẻ trắng, nút xanh, ≤ 560 px).
// Kiểu khớp cấu trúc với `PartnerNoticeInput/Mail` của cổng kit (domain không import kit).
type PartnerNoticeInput = {
  senderName: string;
  title: string;
  message: string | null;
  round: number;
  expiresAt: Date;
  link: string;
};
type PartnerNoticeMail = { subject: string; text: string; html: string };

const clean = (s: string, n: number): string =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, n);
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const vnDate = (d: Date): string =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);

export function buildPartnerNoticeMail(i: PartnerNoticeInput): PartnerNoticeMail {
  const sender = clean(i.senderName || "Một công ty đối tác", 200);
  const title = clean(i.title, 200);
  const deadline = vnDate(i.expiresAt);
  const revised = i.round > 1 ? `Đây là bản sửa lần ${i.round}.` : "";
  const note = i.message ? clean(i.message, 1000) : "";
  const subject = clean(`${sender} gửi hợp đồng ${title} cần anh/chị xác nhận`, 200);
  const intro = `${sender} gửi hợp đồng "${title}" cần anh/chị xác nhận. ${revised}`.trim();
  const text = [
    "Kính gửi anh/chị,",
    "",
    intro,
    ...(note ? ["", `Lời nhắn: ${note}`] : []),
    "",
    `Hạn trả lời: ${deadline}`,
    "Đăng nhập để xem hợp đồng và trả lời tại Hộp thư đối tác:",
    i.link,
    "",
    "Thư này không kèm hợp đồng. Anh/chị cần đăng nhập để xem đầy đủ và trả lời.",
  ].join("\n");
  const html = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f6f8;font-family:'Segoe UI',Arial,sans-serif;color:#1b2430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:20px 10px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dde3ea;border-radius:10px">
<tr><td style="padding:22px 24px 4px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#5b6675">Đề nghị xác nhận hợp đồng</td></tr>
<tr><td style="padding:0 24px;font-size:20px;line-height:1.35;font-weight:600">${esc(title)}</td></tr>
<tr><td style="padding:10px 24px 0;font-size:15px;line-height:1.5">Kính gửi anh/chị,<br><b>${esc(sender)}</b> gửi hợp đồng này cần anh/chị xác nhận. ${esc(revised)}</td></tr>
${note ? `<tr><td style="padding:12px 24px 0;font-size:14px;line-height:1.5"><div style="border-left:3px solid #9bb1c9;padding:4px 12px;color:#37465a">${esc(note)}</div></td></tr>` : ""}
<tr><td style="padding:14px 24px 0;font-size:14px;color:#37465a">Hạn trả lời: <b>${esc(deadline)}</b></td></tr>
<tr><td style="padding:20px 24px 6px"><a href="${esc(i.link)}" style="display:block;text-align:center;background:#1f5fbf;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 22px;border-radius:8px">Xem và trả lời trong Hộp thư đối tác</a></td></tr>
<tr><td style="padding:8px 24px 22px;font-size:12px;line-height:1.5;color:#5b6675">Thư này không kèm hợp đồng. Anh/chị cần đăng nhập để xem đầy đủ và trả lời.</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}
