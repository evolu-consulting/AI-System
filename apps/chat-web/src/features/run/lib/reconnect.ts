// C1-R06 · lịch nối lại khi stream đứt trước sự kiện kết thúc: 0,5 · 1 · 2 · 4 · 8 s (5 lần ≈ 15 s), hết lượt → `lost`.
export const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const;

/** `attempt` đếm từ 1; `null` = đã hết lượt. */
export function reconnectDelay(attempt: number): number | null {
  return RECONNECT_DELAYS_MS[attempt - 1] ?? null;
}
