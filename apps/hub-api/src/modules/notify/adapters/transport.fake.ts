// N3-FR-07 · transport GIẢ cho dev/test: ghi lại mọi tin "đã gửi" trong RAM, cho kịch bản lỗi theo địa chỉ/endpoint. Không mạng.
// Dùng khi `HUB_NOTIFY_MODE=fake` (dev, e2e) và trong test. Thật (SMTP/Web Push) chờ ADR-0027.

import type { EmailTransport, PushTransport } from "../application/ports";
import type { EmailMessage, PushMessage, SendResult } from "../domain/notify.rules";

export type FakeScript = (key: string) => SendResult | undefined;

export class FakeEmailTransport implements EmailTransport {
  readonly sent: EmailMessage[] = [];
  /** Số lời gọi `sendBatch` (kiểm "một lời gọi mỗi lô"). */
  calls = 0;
  /** Kịch bản theo địa chỉ nhận: trả kết quả ép sẵn thay vì gửi. */
  script: FakeScript = () => undefined;
  /** Ném lỗi mạng ở lời gọi kế (một lần). */
  failNext: Error | null = null;

  async sendBatch(msgs: readonly EmailMessage[]): Promise<SendResult[]> {
    this.calls++;
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    return msgs.map((m) => {
      const forced = this.script(m.to);
      if (forced) return forced;
      this.sent.push(m);
      return { ok: true } as const;
    });
  }
}

export class FakePushTransport implements PushTransport {
  readonly sent: PushMessage[] = [];
  calls = 0;
  script: FakeScript = () => undefined;
  failNext: Error | null = null;

  async sendBatch(msgs: readonly PushMessage[]): Promise<SendResult[]> {
    this.calls++;
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    return msgs.map((m) => {
      const forced = this.script(m.endpoint);
      if (forced) return forced;
      this.sent.push(m);
      return { ok: true } as const;
    });
  }
}
