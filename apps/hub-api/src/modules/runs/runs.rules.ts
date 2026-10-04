// HUB-FR-89 · Luật thuần Run: Last-Event-ID, hết hạn, lease, timeout hàng đợi (plan §6.4). Stub B0.
export type RunStatusLike = "running" | "finished" | "failed" | "cancelled";

export function parseLastEventId(
  _header: string | null | undefined,
  _query: string | null | undefined,
): number {
  throw new Error("not implemented");
}

export function eventsExpired(
  _r: { status: RunStatusLike; finishedAt: Date | null },
  _now: Date,
  _retentionS: number,
): boolean {
  throw new Error("not implemented");
}

export function leaseExpired(_leaseUntil: Date | null, _now: Date): boolean {
  throw new Error("not implemented");
}

export function queueTimeoutReason(_c: {
  tenantRunning: number;
  tenantLimit: number | null;
}): "tenant_slots" | "provider_busy" {
  throw new Error("not implemented");
}
