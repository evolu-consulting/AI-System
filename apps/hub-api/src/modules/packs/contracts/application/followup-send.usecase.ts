// W1b · gửi hẹn nhắc chung đúng giờ — cùng khuôn vòng nhắc HD4 (`remind-due.usecase.ts`): một lô = một tenant; tìm tenant có hẹn nhắc tới
// hạn (role `contracts_job`), rồi trong tx `system(tenant)` MỘT câu: claim ≤ `batchSize` (FOR UPDATE SKIP LOCKED) → đánh dấu `sent` →
// `notify.enqueue` (dedup_key theo hẹn nhắc + giờ hẹn ⇒ gửi lại / chạy song song không nhân đôi). "Giờ hẹn" trong thông báo theo ngày +
// giờ lịch của tenant. `drain` chạy tới hết việc, bỏ qua tenant lỗi / đang bị instance khác khoá trong lượt đó; không sleep.
export type FollowupSendRepo = {
  /** Gửi ≤ `limit` hẹn nhắc `pending` có `due_at <= now` của tenant tx; trả số hàng đã claim / số thông báo mới. */
  sendDue(now: Date, limit: number, tz: string): Promise<{ claimed: number; notified: number }>;
};
export type FollowupDueFinder = {
  /** Tenant có hẹn nhắc tới hạn sớm nhất, trừ `skip`; không còn ⇒ null. */
  next(now: Date, skip: readonly string[]): Promise<string | null>;
};
export type FollowupSendUow = {
  system<T>(
    tenantId: string,
    fn: (r: { followupSend: FollowupSendRepo }) => Promise<T>,
  ): Promise<T>;
};
export type FollowupSendDeps = {
  finder: FollowupDueFinder;
  uow: FollowupSendUow;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now: () => Date;
  batchSize: number;
  log?: { warn(msg: string, meta: Record<string, unknown>): void };
};
export type FollowupSendBatch = { tenantId: string; claimed: number; notified: number };
export type FollowupSendTotals = {
  batches: number;
  claimed: number;
  notified: number;
  failed: number;
};

export function createFollowupSender(d: FollowupSendDeps) {
  const batch = async (tenantId: string, now: Date): Promise<FollowupSendBatch> => {
    const tz = await d.timeZoneOf(tenantId);
    const r = await d.uow.system(tenantId, ({ followupSend }) =>
      followupSend.sendDue(now, d.batchSize, tz),
    );
    return { tenantId, ...r };
  };

  /** Một lô (một tenant); không có việc ⇒ null. */
  const once = async (skip: readonly string[] = []): Promise<FollowupSendBatch | null> => {
    const now = d.now();
    const tenantId = await d.finder.next(now, skip);
    return tenantId === null ? null : batch(tenantId, now);
  };

  const drain = async (maxBatches = 100_000): Promise<FollowupSendTotals> => {
    const t: FollowupSendTotals = { batches: 0, claimed: 0, notified: 0, failed: 0 };
    const skip: string[] = [];
    for (let i = 0; i < maxBatches; i++) {
      const now = d.now();
      const tenantId = await d.finder.next(now, skip);
      if (tenantId === null) break;
      try {
        const b = await batch(tenantId, now);
        if (b.claimed === 0) skip.push(tenantId); // hàng đang bị instance khác khoá ⇒ để lượt sau
        t.batches += b.claimed > 0 ? 1 : 0;
        t.claimed += b.claimed;
        t.notified += b.notified;
      } catch (err) {
        skip.push(tenantId);
        t.failed++;
        d.log?.warn("contracts-followup-send-failed", {
          tenantId,
          error: (err as Error)?.name ?? "Error",
        });
      }
    }
    return t;
  };
  return { once, drain };
}
export type FollowupSender = ReturnType<typeof createFollowupSender>;
