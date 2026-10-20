// W1b · gửi hẹn nhắc chung đúng giờ — cùng khuôn vòng nhắc HD4 (`remind-due.usecase.ts`): một lô = một tenant; tìm tenant có hẹn nhắc tới
// hạn (role `contracts_job`), rồi trong tx `system(tenant)` MỘT câu: claim ≤ `batchSize` (FOR UPDATE SKIP LOCKED) → đánh dấu `sent` →
// `notify.enqueue` (dedup_key theo hẹn nhắc + giờ hẹn ⇒ gửi lại / chạy song song không nhân đôi). "Giờ hẹn" trong thông báo theo ngày +
// giờ lịch của tenant. `drain` chạy tới hết việc, bỏ qua tenant lỗi / đang bị instance khác khoá trong lượt đó; không sleep.
// Một hàng xấu không chặn hàng đợi (review B #8): lô lỗi DỮ LIỆU (SQLSTATE 22xxx/23xxx) ⇒ gửi riêng hàng đầu; vẫn lỗi ⇒ hàng đầu đánh
// dấu `sent` không thông báo (ghi log) để các hàng sau đi tiếp. Lỗi khác (mạng, khoá) ⇒ ném lên, lượt sau thử lại, không bỏ hàng nào.
export type FollowupSendRepo = {
  /** Gửi ≤ `limit` hẹn nhắc `pending` có `due_at <= now` của tenant tx; trả số hàng đã claim / số thông báo mới. */
  sendDue(now: Date, limit: number, tz: string): Promise<{ claimed: number; notified: number }>;
  /** Đánh dấu `sent` (không thông báo) hẹn nhắc tới hạn sớm nhất chưa bị khoá; trả id hoặc null. */
  skipHead(now: Date): Promise<string | null>;
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
export type FollowupSendBatch = {
  tenantId: string;
  claimed: number;
  notified: number;
  /** Có khi hàng đầu bị bỏ qua vì lỗi dữ liệu. */
  skipped?: string;
};

/** SQLSTATE của lỗi Postgres (driver đặt ở `code`, lớp bọc ORM ở `cause.code`). */
export function pgStateOf(err: unknown): string | null {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const c = e?.code ?? e?.cause?.code;
  return typeof c === "string" && /^[0-9A-Z]{5}$/.test(c) ? c : null;
}
/** Lỗi do DỮ LIỆU của hàng (22 = dữ liệu sai, 23 = vi phạm ràng buộc): thử lại không bao giờ khỏi. */
export const isDataError = (err: unknown): boolean => /^2[23]/.test(pgStateOf(err) ?? "");
export type FollowupSendTotals = {
  batches: number;
  claimed: number;
  notified: number;
  failed: number;
};

export function createFollowupSender(d: FollowupSendDeps) {
  const send = (tenantId: string, now: Date, limit: number, tz: string) =>
    d.uow.system(tenantId, ({ followupSend }) => followupSend.sendDue(now, limit, tz));

  /** Lô lỗi dữ liệu: gửi riêng hàng đầu; vẫn lỗi dữ liệu ⇒ bỏ qua hàng đầu (một hàng mỗi lượt ⇒ hàng đợi luôn tiến). */
  const isolate = async (tenantId: string, now: Date, tz: string): Promise<FollowupSendBatch> => {
    try {
      return { tenantId, ...(await send(tenantId, now, 1, tz)) };
    } catch (err) {
      if (!isDataError(err)) throw err;
      const id = await d.uow.system(tenantId, ({ followupSend }) => followupSend.skipHead(now));
      d.log?.warn("contracts-followup-skipped", { tenantId, followupId: id, code: pgStateOf(err) });
      return id
        ? { tenantId, claimed: 1, notified: 0, skipped: id }
        : { tenantId, claimed: 0, notified: 0 };
    }
  };

  const batch = async (tenantId: string, now: Date): Promise<FollowupSendBatch> => {
    const tz = await d.timeZoneOf(tenantId);
    try {
      return { tenantId, ...(await send(tenantId, now, d.batchSize, tz)) };
    } catch (err) {
      if (!isDataError(err)) throw err;
      return isolate(tenantId, now, tz);
    }
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
