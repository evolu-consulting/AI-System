// N3-FR-05 · N3-FR-06 · N3-FR-07 · luật thuần của cổng thông báo (không I/O, không import lớp khác): backoff, kết cục một lần
// gửi, mã lỗi an toàn để lưu/log, nội dung email/push. Thời gian do người gọi truyền (đồng hồ giả trong test).

/** Số lần gửi tối đa một bản gửi (tính cả lần đầu). Quá ⇒ `dead`. */
export const MAX_ATTEMPTS = 5;
/** Chờ sau lần thất bại thứ 1…4: 1 phút, 5 phút, 30 phút, 2 giờ. */
export const BACKOFF_SEC = [60, 300, 1800, 7200] as const;
/** Hạn thuê khi claim: quá hạn mà chưa ghi kết quả (crash) ⇒ lô khác nhận lại. */
export const LEASE_SEC = 120;
/** Hạn một lời gọi transport — nhỏ hơn lease để lượt đang gửi chưa bị claim lại. */
export const TRANSPORT_TIMEOUT_MS = 60_000;
export const BATCH_SIZE = 100;

export type Channel = "email" | "push";

/** Kết quả transport cho MỘT tin. `permanent` = lỗi không đáng thử lại (địa chỉ sai, 4xx). `gone` (push) = đăng ký hết hạn. */
export type SendResult =
  | { ok: true }
  | { ok: false; permanent: boolean; code: string; gone?: boolean; skip?: boolean };

/** Miền dành riêng/không giao được (RFC 2606/6761): không bao giờ gửi SMTP thật tới đó. */
const RESERVED_TLDS = ["invalid", "test", "example", "localhost"];
const RESERVED_DOMAINS = ["example.com", "example.org", "example.net"];
export function isUndeliverableEmail(address: string): boolean {
  const at = address.lastIndexOf("@");
  const d = address
    .slice(at + 1)
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
  if (at < 0 || d === "") return false;
  const tld = d.slice(d.lastIndexOf(".") + 1);
  return (
    RESERVED_TLDS.includes(tld) || RESERVED_DOMAINS.some((r) => d === r || d.endsWith(`.${r}`))
  );
}
/** Kết quả "bỏ qua": không phải lỗi, không thử lại. */
export const skippedReserved: SendResult = {
  ok: false,
  permanent: true,
  skip: true,
  code: "skipped_reserved_domain",
};

export type Settled =
  | { outcome: "sent" }
  | { outcome: "skipped"; error: string }
  | { outcome: "retry"; delaySec: number; error: string }
  | { outcome: "dead"; error: string };

/** Mã lỗi lưu DB/log: chữ thường, số, `_`, `.`, `-`, ≤ 64 ký tự; tuyệt đối không nội dung thông báo hay địa chỉ. */
export function safeCode(raw: string): string {
  const s = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (s === "" ? "send_failed" : s).slice(0, 64);
}

/** `attempts` = số lần đã thử TÍNH CẢ lần vừa xong (claim đã cộng). */
export function settle(attempts: number, r: SendResult): Settled {
  if (r.ok) return { outcome: "sent" };
  const error = safeCode(r.code);
  if (r.skip) return { outcome: "skipped", error };
  if (r.permanent || attempts >= MAX_ATTEMPTS) return { outcome: "dead", error };
  const delaySec = BACKOFF_SEC[Math.min(attempts, BACKOFF_SEC.length) - 1] ?? BACKOFF_SEC[0];
  return { outcome: "retry", delaySec, error };
}

/** Lỗi transport ném ra (mất kết nối…) ⇒ thử lại, chỉ giữ tên lỗi làm mã. */
export function thrownResult(err: unknown): SendResult {
  const name = err instanceof Error ? err.name : "error";
  return { ok: false, permanent: false, code: `transport_${name}` };
}

/** Một bản gửi đã claim kèm dữ liệu cần để gửi (đọc cùng câu claim). */
export type Claimed = {
  id: string; // bigint dưới dạng chuỗi
  tenantId: string;
  userId: string;
  channel: Channel;
  attempts: number;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  email: string;
  displayName: string;
  locale: "vi" | "en";
  subs: { endpoint: string; p256dh: string; auth: string }[];
};

export type EmailMessage = {
  /** Khóa idempotency: transport đặt làm Message-ID để gửi lại (crash) không thành hai thư. */
  idempotencyKey: string;
  tenantId: string;
  to: string;
  toName: string;
  subject: string;
  text: string;
};
export type PushMessage = {
  idempotencyKey: string;
  tenantId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  payload: string; // JSON {title, body, link}
};

/** Thay mọi ký tự điều khiển (kể cả CR/LF) bằng dấu cách — chống chèn header thư. */
function stripCtl(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 32;
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return out.replace(/ +/g, " ").trim();
}

export function emailOf(c: Claimed, baseUrl: string): EmailMessage {
  const link = c.link ? `${baseUrl.replace(/\/+$/, "")}${c.link}` : "";
  const text = [c.body, link].filter((x) => x !== "").join("\n\n");
  return {
    idempotencyKey: `n3-${c.id}`,
    tenantId: c.tenantId,
    to: c.email,
    toName: stripCtl(c.displayName),
    subject: stripCtl(c.title), // tiêu đề thư không được chứa xuống dòng (chống chèn header)
    text,
  };
}

/** Push: một tin mỗi đăng ký của người nhận (nhiều thiết bị). Payload nhỏ, không quá 1 KB. */
export function pushOf(c: Claimed): PushMessage[] {
  const payload = JSON.stringify({
    title: c.title.slice(0, 120),
    body: c.body.slice(0, 200),
    link: c.link,
  });
  return c.subs.map((s) => ({
    idempotencyKey: `n3-${c.id}`,
    tenantId: c.tenantId,
    endpoint: s.endpoint,
    p256dh: s.p256dh,
    auth: s.auth,
    payload,
  }));
}

/**
 * Gộp kết quả theo từng đăng ký push thành MỘT kết quả cho bản gửi: có ít nhất một đăng ký nhận được ⇒ sent; mọi đăng ký
 * đều hỏng vĩnh viễn ⇒ permanent; còn lại ⇒ thử lại. Không có đăng ký (đã bị xóa giữa chừng) ⇒ permanent `no_subscription`.
 */
export function mergePush(results: readonly SendResult[]): SendResult {
  if (results.length === 0) return { ok: false, permanent: true, code: "no_subscription" };
  if (results.some((r) => r.ok)) return { ok: true };
  const failed = results.filter((r): r is Extract<SendResult, { ok: false }> => !r.ok);
  const retryable = failed.find((r) => !r.permanent);
  if (retryable) return retryable;
  return failed[0] ?? { ok: false, permanent: true, code: "push_failed" };
}

// gap-c #11 · tùy chọn nhắc hạn: mốc hiệu lực = mốc riêng của người dùng, vắng thì mặc định của tenant (cùng luật SQL `notify.enqueue`).
export const LEAD_GRID = [60, 30, 7, 1, 0] as const;
export const effectiveLeadDays = (
  own: readonly number[] | null,
  tenantDefault: readonly number[] | null,
): number[] => [...(own ?? tenantDefault ?? LEAD_GRID)].sort((a, b) => b - a);
/** Mốc `lead` có được nhắc cho người này không (mốc rỗng = tắt nhắc hạn). */
export const allowsLead = (
  lead: number,
  own: readonly number[] | null,
  tenantDefault: readonly number[] | null,
): boolean => effectiveLeadDays(own, tenantDefault).includes(lead);
