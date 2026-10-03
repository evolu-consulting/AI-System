// ADM-FR-41 (mail cảnh báo quota R05), ADM-FR-08 · Mailer dùng chung (plan-cd §9, ADR-0005).
// Chỉ file này import nodemailer. Không retry; gửi sau commit là việc bên gọi. Log không chứa địa chỉ/nội dung.
import { EmailSchema } from "@ai/contracts";
import nodemailer from "nodemailer";
import type { Env } from "../../config/env";
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
const DEFAULT_FROM = "AI System <no-reply@ai-system.local>";

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

export function createMailer(env: Pick<Env, "SMTP_URL" | "MAIL_FROM">): Mailer {
  const url = env.SMTP_URL;
  if (!url) {
    return {
      async send() {
        throw new MailError("MAIL_DISABLED");
      },
    };
  }
  const from = env.MAIL_FROM || DEFAULT_FROM;
  const transport = nodemailer.createTransport({
    url,
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
  });
  return {
    async send(m) {
      validate(m);
      try {
        await transport.sendMail({
          from,
          to: [...m.to],
          subject: m.subject,
          text: m.text,
          html: m.html,
        });
      } catch {
        logger.error("mail-send-failed", { recipients: m.to.length, code: "MAIL_SEND_FAILED" });
        throw new MailError("MAIL_SEND_FAILED");
      }
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
