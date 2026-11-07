// CR-124 · q5 · kiểu dữ liệu của đường email (lớp 1, không I/O): dòng thuê gửi thư, góc nhìn trang công khai, mã kết quả trả lời.
import type { Outcome } from "./email-link.rules";

export type ClaimedEmail = {
  id: string;
  from_tenant: string;
  to_email: string;
  round: number;
  payload: Record<string, unknown>;
  file_ref: string | null;
  expires_at: string | Date;
  prev_reason: string | null;
  sender_name: string | null;
  sender_verified: boolean;
  attempts: number;
};

export type EmailView = {
  mailbox_id: string;
  from_tenant: string;
  state: "open" | "replied" | "closed" | "expired";
  round: number;
  payload: Record<string, unknown> | null;
  file_ref: string | null;
  pdf_sha256: string | null;
  expires_at: string | Date;
  outcome: Outcome | null;
  reason: string | null;
  prev_reason: string | null;
  sender_name: string | null;
  sender_tax_code: string | null;
  sender_verified: boolean;
};

export type ReplyCode = "ok" | "same" | "conflict" | "closed" | "expired" | "invalid";

export type ReplyValues = { outcome: Outcome; reason: string; name: string; title: string };
export type ViewOpts = { ip: string | null; ua: string | null; audit: boolean };
export type ReplyOpts = { ip: string | null; ua: string | null };

/** Cổng dữ liệu của trang công khai (mount dựng từ SQL; route không biết DB). */
export type PublicStore = {
  view(tokenHash: string, o: ViewOpts): Promise<EmailView | null>;
  reply(tokenHash: string, f: ReplyValues, o: ReplyOpts): Promise<ReplyCode>;
};
