// HUB-FR-66 · hiển thị trạng thái provider: nhãn, cooldown (phút làm tròn lên), nút theo loại.
import type { ProviderItem } from "../api";

export const statusKey = (p: ProviderItem) => p.state?.status ?? "none";

/** Số phút còn lại tới `cooldown_until` (làm tròn gần nhất, ≥ 1; xem spec §10 tranh chấp M02) hoặc null khi không cooldown. */
export function cooldownMinutes(p: ProviderItem, now = Date.now()): number | null {
  const until = p.state?.status === "cooldown" ? p.state.cooldown_until : null;
  if (!until) return null;
  const ms = new Date(until).getTime() - now;
  return Number.isNaN(ms) ? null : Math.max(1, Math.round(ms / 60_000));
}

export const needsGuide = (p: ProviderItem) =>
  p.kind === "subscription" && (p.state?.status === "logged_out" || p.state?.status === "error");
