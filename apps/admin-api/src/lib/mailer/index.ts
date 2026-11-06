// ADM-FR-41 (mail cảnh báo quota R05), ADM-FR-08 · Mailer dùng chung (plan-cd §9, ADR-0005).
// Gửi qua Hub (CR-121 c21b), admin-api không còn nodemailer/SMTP. Không retry; gửi sau commit là việc bên gọi. Log không chứa địa chỉ/nội dung.
import { EmailSchema } from "@ai/contracts/common";
import { logger } from "../logger";

export type MailMessage = {
  to: readonly string[];
  subject: string;
  text: string;
  html?: string;
};
export interface Mailer {
  send(m: MailMessage): Promise<void>;
}
export type MailErrorCode = "MAIL_DISABLED" | "MAIL_SEND_FAILED" | "MAIL_INVALID";

export class MailError extends Error {
  readonly code: MailErrorCode;
  constructor(code: MailErrorCode) {
    super(code);
    this.name = "MailError";
    this.code = code;
  }
}

const TO_MAX = 50;
const SUBJECT_MAX = 200;
const BODY_MAX = 100 * 1024;

function validate(m: MailMessage): void {
  const bad =
    m.to.length < 1 ||
    m.to.length > TO_MAX ||
    !m.to.every((a) => EmailSchema.safeParse(a).success) ||
    m.subject.length < 1 ||
    m.subject.length > SUBJECT_MAX ||
    /[\r\n]/.test(m.subject) ||
    Buffer.byteLength(m.text) > BODY_MAX ||
    (m.html !== undefined && Buffer.byteLength(m.html) > BODY_MAX);
  if (bad) throw new MailError("MAIL_INVALID");
}

export type HubMailConfig = { url?: string; token?: string };

/** Mã lỗi Hub (`error.code`) → mã mailer: cấu hình mail ở Hub chưa có/thông báo tắt ⇒ MAIL_DISABLED; còn lại ⇒ MAIL_SEND_FAILED. */
const codeOf = async (res: Response): Promise<string | undefined> => {
  try {
    const b = (await res.json()) as { error?: { code?: unknown } | string; code?: unknown };
    const c = typeof b.error === "object" ? b.error?.code : (b.error ?? b.code);
    return typeof c === "string" ? c : undefined;
  } catch {
    return undefined;
  }
};

/**
 * CR-121 c21b (D4): admin-api KHÔNG giữ cấu hình SMTP — gửi qua Hub `POST /internal/mail` (token dịch vụ `HUB_INTERNAL_TOKEN`,
 * cùng cơ chế `/internal/test-run`); Hub dùng cấu hình mail trong kho secret. Thiếu `ADMIN_HUB_URL`/token ⇒ MAIL_DISABLED.
 * Token chỉ nằm trong header; không log thân/địa chỉ.
 */
export function createMailer(
  cfg: HubMailConfig,
  fetchFn: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Mailer {
  const { url, token } = cfg;
  if (!url || !token) {
    return {
      async send() {
        throw new MailError("MAIL_DISABLED");
      },
    };
  }
  const endpoint = `${url.replace(/\/+$/, "")}/internal/mail`;
  return {
    async send(m) {
      validate(m);
      let res: Response;
      try {
        res = await fetchFn(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ to: m.to, subject: m.subject, text: m.text }),
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
        });
      } catch {
        logger.error("mail-send-failed", { recipients: m.to.length, code: "MAIL_SEND_FAILED" });
        throw new MailError("MAIL_SEND_FAILED");
      }
      if (res.ok) return;
      const code = await codeOf(res);
      if (res.status === 409 && code === "NOT_CONFIGURED") throw new MailError("MAIL_DISABLED");
      logger.error("mail-send-failed", {
        recipients: m.to.length,
        code: "MAIL_SEND_FAILED",
        status: res.status,
      });
      throw new MailError("MAIL_SEND_FAILED");
    },
  };
}
export function createMemoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(m) {
      validate(m);
      sent.push(m);
    },
  };
}
