// CR-124 · q5 · FLOW4-FR-12/13 · spec §8 · luật thuần (lớp 1) của đường email cho bên nhận chưa dùng nền tảng: token, link, IP rút gọn, kiểm form
// trả lời, mẫu thư tiếng Việt. Không I/O (băm/ngẫu nhiên dùng Web Crypto chuẩn). Token chỉ tồn tại trong email + URL; DB chỉ giữ băm SHA-256.

export const PARTNER_PUBLIC_PATH = "/partner-reply";
/** Token 256-bit ngẫu nhiên, base64url không đệm = 43 ký tự. */
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Hạn mức (spec §8 "Chống lạm dụng"): mở trang / PDF / trả lời trên mỗi token (1 giờ); mọi yêu cầu trên mỗi IP (1 phút); link sai trên mỗi IP (10 phút). */
export const EMAIL_LIMITS = {
  openPerTokenHour: 30,
  pdfPerTokenHour: 60,
  replyPerTokenHour: 10,
  perIpMinute: 60,
  badTokenPerIp10Min: 10,
} as const;

export const EMAIL_BATCH = 50;
export const EMAIL_LEASE_S = 120;
export const EMAIL_MAX_ATTEMPTS = 5;

export type Outcome = "confirmed" | "returned" | "declined";

const hex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** SHA-256 của token (32 byte) — thứ duy nhất ghi vào DB. */
export async function hashToken(token: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
}
export const hashHex = async (token: string): Promise<string> => hex(await hashToken(token));

export const sha256Hex = async (bytes: Uint8Array<ArrayBufferLike>): Promise<string> =>
  hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));

export function linkOf(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${PARTNER_PUBLIC_PATH}/${token}`;
}

/** IP rút gọn cho nhật ký: IPv4 ⇒ /24; IPv6 ⇒ 3 nhóm đầu (/48); không đọc được ⇒ null. */
export function ipPrefix(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) return `${ip.split(":").slice(0, 3).join(":")}::/48`;
  return null;
}

/** IP client: nginx nối IP kết nối thật vào CUỐI `X-Forwarded-For` (đầu danh sách do client tự khai, không tin). */
export function clientIp(h: { get(name: string): string | undefined | null }): string | null {
  const xff = h.get("x-forwarded-for");
  const last = xff?.split(",").at(-1)?.trim();
  const ip = last || h.get("x-real-ip")?.trim();
  return ip && ip.length <= 64 ? ip : null;
}

const OUTCOME_OF: Record<string, Outcome> = {
  confirm: "confirmed",
  return: "returned",
  decline: "declined",
};

export type ReplyForm = { outcome: Outcome; reason: string; name: string; title: string };
export type FormProblem = "name" | "title" | "reason" | "outcome";

/** Form trả lời: 3 nút (confirm/return/decline); Trả lại/Từ chối bắt buộc lý do; họ tên + chức vụ bắt buộc. */
export function parseReplyForm(
  f: Readonly<Record<string, unknown>>,
): { ok: true; form: ReplyForm } | { ok: false; problem: FormProblem } {
  const str = (k: string): string => (typeof f[k] === "string" ? (f[k] as string).trim() : "");
  const outcome = OUTCOME_OF[str("action")];
  if (!outcome) return { ok: false, problem: "outcome" };
  const name = str("name");
  const title = str("title");
  const reason = str("reason");
  if (name.length < 2 || name.length > 120) return { ok: false, problem: "name" };
  if (title.length < 2 || title.length > 120) return { ok: false, problem: "title" };
  if (outcome !== "confirmed" && (reason.length === 0 || reason.length > 2000))
    return { ok: false, problem: "reason" };
  if (outcome === "confirmed" && reason.length > 2000) return { ok: false, problem: "reason" };
  return { ok: true, form: { outcome, reason, name, title } };
}

export const PROBLEM_TEXT: Record<FormProblem, string> = {
  outcome: "Vui lòng chọn Xác nhận, Trả lại sửa hoặc Từ chối.",
  name: "Vui lòng nhập họ tên của bạn (2–120 ký tự).",
  title: "Vui lòng nhập chức vụ của bạn (2–120 ký tự).",
  reason: "Trả lại sửa hoặc Từ chối cần ghi lý do (tối đa 2000 ký tự).",
};

export const OUTCOME_TEXT: Record<Outcome, string> = {
  confirmed: "Đã xác nhận",
  returned: "Đã trả lại sửa",
  declined: "Đã từ chối",
};

const FIELD_LABEL: Record<string, string> = {
  total_value: "Giá trị hợp đồng",
  start_date: "Ngày hiệu lực",
  end_date: "Ngày hết hạn",
  payment_term: "Hạn thanh toán",
};

/** Các trường A chọn gửi kèm → dòng hiển thị (nhãn nghiệp vụ). Khoá lạ bị bỏ — chỉ hiện đúng bốn trường được phép chia sẻ. */
export function sharedRows(fields: unknown): { label: string; value: string }[] {
  if (!fields || typeof fields !== "object") return [];
  const rows: { label: string; value: string }[] = [];
  for (const [k, label] of Object.entries(FIELD_LABEL)) {
    const v = (fields as Record<string, unknown>)[k];
    if (v === undefined || v === null || v === "") continue;
    const n = typeof v === "number" ? v : Number(v);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
    const text =
      k === "total_value" && Number.isFinite(n)
        ? `${n.toLocaleString("vi-VN")} đ`
        : iso
          ? `${iso[3]}/${iso[2]}/${iso[1]}`
          : String(v).slice(0, 200);
    rows.push({ label, value: text });
  }
  return rows;
}

export const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Ngày dd/mm/yyyy theo giờ Việt Nam. */
export function vnDate(d: Date): string {
  return new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

export type EmailInput = {
  mailboxId: string;
  attempts: number;
  tenantId: string;
  to: string;
  link: string;
  title: string;
  senderName: string;
  senderVerified: boolean;
  round: number;
  message: string | null;
  prevReason: string | null;
  expiresAt: Date;
};

const clean = (s: string, n: number): string =>
  s
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, n);

/** Thư tiếng Việt (văn bản + HTML). Ngôn ngữ nghiệp vụ: không "token"; nói rõ link riêng, một lần trả lời, không phải chữ ký số. */
export function buildPartnerEmail(i: EmailInput) {
  const sender = clean(i.senderName || "Một công ty đối tác", 200);
  const title = clean(i.title, 200);
  const deadline = vnDate(i.expiresAt);
  const verified = i.senderVerified ? "đã được nền tảng xác minh" : "chưa được nền tảng xác minh";
  const revised = i.round > 1 ? `Đây là bản sửa lần ${i.round}.` : "";
  const prev = i.prevReason
    ? `Lần trước hợp đồng được trả lại vì: ${clean(i.prevReason, 500)}`
    : "";
  const note = i.message ? clean(i.message, 1000) : "";
  const subject = clean(`${sender} đề nghị xác nhận hợp đồng "${title}"`, 200);
  const text = [
    "Kính gửi Quý đối tác,",
    "",
    `${sender} (${verified}) gửi Quý công ty hợp đồng "${title}" để xác nhận. ${revised}`.trim(),
    ...(prev ? ["", prev] : []),
    ...(note ? ["", `Lời nhắn: ${note}`] : []),
    "",
    `Hạn trả lời: ${deadline}`,
    "Xem hợp đồng và trả lời (không cần tài khoản):",
    i.link,
    "",
    "Đường dẫn này dành riêng cho thư này và chỉ trả lời được một lần. Vui lòng không chuyển tiếp.",
    "Xác nhận qua email chỉ ghi nhận ý kiến của Quý công ty, không phải chữ ký số.",
    "Nếu Quý vị không liên quan đến hợp đồng này, xin bỏ qua thư.",
  ].join("\n");
  const e = escapeHtml;
  const html = `<!doctype html><html lang="vi"><body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Arial,sans-serif;color:#1b2430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dde3ea;border-radius:10px">
<tr><td style="padding:24px 28px 8px;font-size:13px;color:#5b6675">Đề nghị xác nhận hợp đồng</td></tr>
<tr><td style="padding:0 28px;font-size:20px;font-weight:600;line-height:1.35">${e(title)}</td></tr>
<tr><td style="padding:12px 28px 0;font-size:15px;line-height:1.55">Kính gửi Quý đối tác,<br><br><b>${e(sender)}</b> (${e(verified)}) gửi Quý công ty hợp đồng này để xác nhận. ${e(revised)}</td></tr>
${prev ? `<tr><td style="padding:12px 28px 0;font-size:14px;line-height:1.5;color:#8a4b00">${e(prev)}</td></tr>` : ""}
${note ? `<tr><td style="padding:12px 28px 0;font-size:14px;line-height:1.5"><div style="border-left:3px solid #9bb1c9;padding:4px 12px;color:#37465a">${e(note)}</div></td></tr>` : ""}
<tr><td style="padding:16px 28px 0;font-size:14px;color:#37465a">Hạn trả lời: <b>${e(deadline)}</b></td></tr>
<tr><td style="padding:20px 28px 8px"><a href="${e(i.link)}" style="display:inline-block;background:#1f5fbf;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px">Xem hợp đồng và trả lời</a></td></tr>
<tr><td style="padding:8px 28px 4px;font-size:12px;color:#5b6675;line-height:1.5">Không cần tài khoản. Đường dẫn dành riêng cho thư này và chỉ trả lời được một lần, vui lòng không chuyển tiếp.</td></tr>
<tr><td style="padding:4px 28px 24px;font-size:12px;color:#5b6675;line-height:1.5">Xác nhận qua email chỉ ghi nhận ý kiến của Quý công ty, không phải chữ ký số. Nếu Quý vị không liên quan đến hợp đồng này, xin bỏ qua thư.</td></tr>
</table></td></tr></table></body></html>`;
  return {
    idempotencyKey: `partner-email-${i.mailboxId}-${i.attempts}`,
    tenantId: i.tenantId,
    to: i.to,
    toName: "Quý đối tác",
    subject,
    text,
    html,
  };
}
