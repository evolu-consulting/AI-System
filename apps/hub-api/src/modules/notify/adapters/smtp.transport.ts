// N3-FR-07 · ADR-0027 · transport EMAIL thật trên `nodemailer` (hộp thư pool, SMTP nền tảng MỘT bộ — D-04). Mật khẩu KHÔNG ở đây:
// `getPassword()` do nơi dựng truyền vào (CR-121 D4: cấu hình + mật khẩu từ kho secret Hub, xem `mail-config.ts`). Không log nội dung/địa chỉ.
// Mỗi tin một `sendMail` song song (pool giới hạn kết nối); lỗi ánh xạ qua `mapSmtpError` (thuần, có test).
import nodemailer from "nodemailer";
import type { EmailTransport } from "../application/ports";
import {
  type EmailMessage,
  isUndeliverableEmail,
  type SendResult,
  skippedReserved,
} from "../domain/notify.rules";

const SKIPPED = Symbol("skipped");

export type SmtpConfig = {
  host: string;
  port: number;
  /** true = TLS ngay (cổng 465); false = STARTTLS khi server hỗ trợ (587). */
  secure: boolean;
  /** Rỗng ⇒ không xác thực (relay nội bộ). */
  user: string;
  from: string;
  /** Miền dựng Message-ID (idempotency) — lấy từ địa chỉ `from`. */
  maxConnections?: number;
};

/** Phần của nodemailer mà adapter dùng (tiêm stub trong test, không mạng). */
export type MailSender = {
  sendMail(m: {
    from: string;
    to: { name: string; address: string };
    subject: string;
    text: string;
    html?: string;
    attachments?: {
      cid: string;
      filename: string;
      contentType: string;
      contentDisposition: "inline";
      content: Buffer;
    }[];
    messageId: string;
  }): Promise<unknown>;
};
export type MailFactory = (cfg: SmtpConfig, password: string | undefined) => MailSender;

export const realMailFactory: MailFactory = (cfg, password) =>
  nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    pool: true,
    maxConnections: cfg.maxConnections ?? 3,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 40_000, // tất cả < TRANSPORT_TIMEOUT_MS (60 s) < lease
    ...(cfg.user ? { auth: { user: cfg.user, pass: password ?? "" } } : {}),
  }) as MailSender;

/** 5xx từ server (trừ lỗi xác thực/cấu hình) và địa chỉ sai ⇒ vĩnh viễn; 4xx, mạng, timeout, xác thực ⇒ thử lại. */
export function mapSmtpError(err: unknown): SendResult {
  const e = (err ?? {}) as { responseCode?: number; code?: string };
  const rc = typeof e.responseCode === "number" ? e.responseCode : 0;
  if (e.code === "EENVELOPE") return { ok: false, permanent: true, code: "smtp_envelope" };
  if (e.code === "EAUTH") return { ok: false, permanent: false, code: "smtp_auth" };
  if (rc >= 500 && rc !== 535) return { ok: false, permanent: true, code: `smtp_${rc}` };
  if (rc >= 400) return { ok: false, permanent: false, code: `smtp_${rc}` };
  return { ok: false, permanent: false, code: `smtp_${(e.code ?? "error").toLowerCase()}` };
}

/**
 * CR-121 c21 · cấu hình + mật khẩu lấy từ kho secret Hub ở lần gửi đầu (không đọc env). Lỗi lấy secret ném ra ⇒ cả lô thử lại
 * (safeBatch), lần sau đọc lại; thành công ⇒ dựng transport một lần.
 */
export function createStoredSmtpTransport(
  getMail: () => Promise<{ smtp: SmtpConfig; password: string }>,
  factory: MailFactory = realMailFactory,
): EmailTransport {
  let inner: EmailTransport | null = null;
  return {
    async sendBatch(msgs) {
      if (!inner) {
        const m = await getMail();
        inner = createSmtpTransport(m.smtp, async () => m.password, factory);
      }
      return inner.sendBatch(msgs);
    },
  };
}

function buildMail(from: string, domain: string, m: EmailMessage) {
  return {
    from,
    to: { name: m.toName, address: m.to },
    subject: m.subject,
    text: m.text,
    ...(m.html ? { html: m.html } : {}),
    ...(m.inline?.length
      ? {
          attachments: m.inline.map((a) => ({
            cid: a.cid,
            filename: `${a.cid}.jpg`,
            contentType: a.contentType,
            contentDisposition: "inline" as const,
            content: Buffer.from(a.base64, "base64"),
          })),
        }
      : {}),
    messageId: `<${m.idempotencyKey}@${domain}>`,
  };
}

export function createSmtpTransport(
  cfg: SmtpConfig,
  getPassword: () => Promise<string | undefined>,
  factory: MailFactory = realMailFactory,
): EmailTransport {
  let sender: MailSender | null = null;
  const domain =
    cfg.from
      .split("@")
      .pop()
      ?.replace(/[^A-Za-z0-9.-]/g, "") || "localhost";
  return {
    async sendBatch(msgs: readonly EmailMessage[]): Promise<SendResult[]> {
      // Lấy mật khẩu chỉ khi cần xác thực; lỗi lấy secret ném ra ⇒ cả lô thử lại (safeBatch).
      sender ??= factory(cfg, cfg.user ? await getPassword() : undefined);
      const s = sender;
      // Miền dành riêng/không giao được: không đụng SMTP, ghi skipped (không phải lỗi).
      const out = await Promise.allSettled(
        msgs.map((m) =>
          isUndeliverableEmail(m.to)
            ? Promise.reject(SKIPPED)
            : s.sendMail(buildMail(cfg.from, domain, m)),
        ),
      );
      return out.map((r) =>
        r.status === "fulfilled"
          ? { ok: true }
          : r.reason === SKIPPED
            ? skippedReserved
            : mapSmtpError(r.reason),
      );
    },
  };
}
