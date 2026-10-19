// N3-FR-04 · N3-FR-05 · N3-FR-07 · cổng của module thông báo (lớp 2 — chỉ kiểu, không import ngoài domain/application).
// Transport nhận CẢ LÔ (một kết nối SMTP / HTTP/2 dùng lại) và trả đúng một kết quả mỗi tin, cùng thứ tự.
import type { Claimed, EmailMessage, PushMessage, SendResult } from "../domain/notify.rules";

export type EmailTransport = { sendBatch(msgs: readonly EmailMessage[]): Promise<SendResult[]> };
export type PushTransport = { sendBatch(msgs: readonly PushMessage[]): Promise<SendResult[]> };

/** Kết cục một bản gửi để ghi lại: `nextAt` chỉ có khi `retry`. */
export type Settlement = {
  id: string;
  outcome: "sent" | "retry" | "dead";
  error: string | null;
  nextAt: string | null;
};

/** Kho cho worker (scope system, mỗi hàm một tx ngắn, một câu SQL). */
export type DispatchStore = {
  /** Chia kênh cho tối đa `limit` thông báo chưa chia; trả số thông báo và số bản gửi tạo. */
  fanout(nowIso: string, limit: number): Promise<{ picked: number; deliveries: number }>;
  /** Nhận tối đa `limit` bản gửi tới hạn (SKIP LOCKED), đặt `sending` + hạn thuê. */
  claim(nowIso: string, limit: number, leaseSec: number): Promise<Claimed[]>;
  /** Ghi kết cục cả lô + xóa đăng ký push hết hạn; trả số bản gửi cập nhật. */
  settle(
    nowIso: string,
    rows: readonly Settlement[],
    goneEndpoints: readonly string[],
  ): Promise<number>;
};

export type NotificationItem = {
  id: string;
  seq: number;
  source: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  created_at: string;
  read: boolean;
};

export type InboxStore = {
  list(
    who: Who,
    limit: number,
    before: number | null,
  ): Promise<{ items: NotificationItem[]; unread: number }>;
  markRead(who: Who, ids: readonly string[] | "all"): Promise<number>;
  prefs(who: Who): Promise<Prefs>;
  setPrefs(who: Who, p: Prefs): Promise<Prefs>;
  subscribe(who: Who, s: { endpoint: string; p256dh: string; auth: string }): Promise<void>;
  unsubscribe(who: Who, endpoint: string): Promise<number>;
};

export type Who = { tenantId: string; userId: string };
export type Prefs = { email: boolean; push: boolean };
