// CR-124 q5 / CR-126 · kiểu dùng chung của hai bộ gửi email nền (thư trả lời qua link `email-dispatch.ts`, thư báo kênh nền tảng `notice-dispatch.ts`).
// Tách riêng để hai bộ gửi không import vòng nhau. Chỉ kiểu — không I/O.
import type { Db } from "@ai/db";
import type { PartnerMailboxPort } from "../packs/kit/public";
import type { buildPartnerEmail } from "./domain/email-link.rules";

export type MailOut = ReturnType<typeof buildPartnerEmail>;
export type MailResult =
  | { ok: true }
  | { ok: false; permanent: boolean; code: string; skip?: boolean };
/** Transport email chung của thông báo (cấu trúc tương thích; không import chéo module notify — ADR-0037). */
export type PartnerMailer = { sendBatch(msgs: readonly MailOut[]): Promise<MailResult[]> };

export type PartnerEmailDeps = {
  db: Db;
  /** Transport email chung (null khi thông báo tắt ⇒ không gửi, dòng nằm chờ). */
  email: () => PartnerMailer | null;
  /** Gốc URL công khai dựng link (vd `https://app.example.vn`). */
  baseUrl: string;
  /** Cổng gói lấy PDF của HĐ gửi / mẫu thư báo (đọc mỗi lượt vì gói đăng ký lúc mount). */
  port: () => PartnerMailboxPort | undefined;
  batch?: number;
};
export type PartnerEmailStats = { claimed: number; sent: number; failed: number };
