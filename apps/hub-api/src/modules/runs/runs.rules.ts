// HUB-FR-42 · HUB-NFR-02 · H1-R12, R13, R18 · luật thuần Run: Last-Event-ID, hết hạn, lease, timeout hàng đợi (plan §6.4).
export type RunStatusLike = "running" | "finished" | "failed" | "cancelled";

const EVENT_ID_RE = /^(0|[1-9]\d*)$/;

function toEventId(v: string): number {
  if (!EVENT_ID_RE.test(v)) return 0;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : 0;
}

/** Header thắng (kể cả khi sai → 0, không rơi về query); thiếu cả hai/sai định dạng/không an toàn → 0 (C1 plan E13). */
export function parseLastEventId(
  header: string | null | undefined,
  query: string | null | undefined,
): number {
  if (header !== null && header !== undefined) return toEventId(header);
  if (query !== null && query !== undefined) return toEventId(query);
  return 0;
}

/** Hết hạn khi đã kết thúc quá `retentionS` (đúng bằng → chưa). `running` không bao giờ hết hạn. */
export function eventsExpired(
  r: { status: RunStatusLike; finishedAt: Date | null },
  now: Date,
  retentionS: number,
): boolean {
  if (r.status === "running" || r.finishedAt === null) return false;
  return now.getTime() - r.finishedAt.getTime() > retentionS * 1000;
}

/** Khớp SQL sweeper `lease_until < now()`; null → false. */
export function leaseExpired(leaseUntil: Date | null, now: Date): boolean {
  return leaseUntil !== null && leaseUntil.getTime() < now.getTime();
}

export function queueTimeoutReason(c: {
  tenantRunning: number;
  tenantLimit: number | null;
}): "tenant_slots" | "provider_busy" {
  return c.tenantLimit !== null && c.tenantRunning >= c.tenantLimit
    ? "tenant_slots"
    : "provider_busy";
}
