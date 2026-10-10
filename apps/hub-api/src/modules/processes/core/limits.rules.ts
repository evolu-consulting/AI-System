// HUB-FR-115 · HUB-FR-116 · HUB-FR-117 · D9 · giới hạn team-run + ngân sách token (plan §3.3, §4, plan-contract §7). Thuần.

/** Giới hạn một team-run (`agent_teams.limits`, mặc định `TEAM_LIMITS_DEFAULT`). */
export type TeamLimits = { max_calls: number; max_tokens: number; max_active_s: number };

/** Kiểm TRƯỚC mỗi lần gọi; thứ tự calls → tokens → time. */
export function teamLimitHit(
  s: { calls: number; tokens: number; activeMs: number },
  l: TeamLimits,
): "calls" | "tokens" | "time" | null {
  if (s.calls >= l.max_calls) return "calls";
  if (s.tokens >= l.max_tokens) return "tokens";
  if (s.activeMs >= l.max_active_s * 1000) return "time";
  return null;
}

/** C1 · `budget` null = không giới hạn; chạm (=) là hết. */
export function budgetHit(used: number, budget: number | null): boolean {
  return budget !== null && used >= budget;
}

/** D9 · token = in + out + cache_read + cache_write (cache vắng = 0). */
export function totalTokens(u: {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
}): number {
  return u.input + u.output + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
}
