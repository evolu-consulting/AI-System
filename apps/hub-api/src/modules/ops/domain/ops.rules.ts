// CR-104 · ops-core · luật thuần của ops-watch: đến hạn lượt kiểm, chuyển trạng thái nào thì báo chuông, khoá dedup, nội dung chuông.
// Không I/O (unit test trực tiếp).
import { OPS_CHECK_META, type OpsCheckKey, type OpsStatus } from "@ai/contracts/hub-admin";

/** Lượt kế tiếp đến hạn khi chưa từng kiểm hoặc đã qua `everyMin` phút kể từ lượt cuối (tính từ DB ⇒ đổi tần suất có hiệu lực ngay). */
export function isDue(last: Date | null, everyMin: number, now: Date): boolean {
  return last === null || now.getTime() - last.getTime() >= everyMin * 60_000;
}

/** "Kiểm tra ngay" tối đa một lần mỗi `gapMs`. */
export function manualAllowed(last: Date | null, gapMs: number, now: Date): boolean {
  return last === null || now.getTime() - last.getTime() >= gapMs;
}

export type Transition = {
  check_key: string;
  from_status: OpsStatus | null;
  to_status: OpsStatus;
  changed_at: Date;
  message: string;
  hint: string | null;
};

export type OpsNotifyKind = "ops.warn" | "ops.crit" | "ops.recovered";

/**
 * Báo khi ĐỔI sang warn/crit (kể cả warn ↔ crit) hoặc hồi phục về ok từ warn/crit. `unknown` (check lỗi/quá giờ) không báo —
 * check DB/Redis tự báo crit khi ping lỗi; từ unknown về ok không phải "hồi phục".
 */
export function notifyKind(from: OpsStatus | null, to: OpsStatus): OpsNotifyKind | null {
  if (from === to) return null;
  if (to === "warn") return "ops.warn";
  if (to === "crit") return "ops.crit";
  if (to === "ok" && (from === "warn" || from === "crit")) return "ops.recovered";
  return null;
}

/** Một khoá cho mỗi lần đổi trạng thái ⇒ chạy lại/nhiều instance không nhân đôi chuông. */
export const opsDedupKey = (check: string, to: OpsStatus, changedAt: Date): string =>
  `ops:${check}:${to}:${changedAt.getTime()}`;

const STATUS_VI: Record<OpsStatus, string> = {
  ok: "Bình thường",
  warn: "Cảnh báo",
  crit: "Nghiêm trọng",
  unknown: "Không rõ",
};

const labelOf = (key: string): string => OPS_CHECK_META[key as OpsCheckKey]?.label ?? key;

export type OpsNotifyItem = { kind: OpsNotifyKind; title: string; body: string; dedup_key: string };

/** Chuyển trạng thái ⇒ mục chuông (mỗi mục được DB nhân ra mọi platform_admin đang hoạt động). */
export function notificationsFor(ts: readonly Transition[]): OpsNotifyItem[] {
  const out: OpsNotifyItem[] = [];
  for (const t of ts) {
    const kind = notifyKind(t.from_status, t.to_status);
    if (!kind) continue;
    const head = kind === "ops.recovered" ? "Đã hồi phục" : STATUS_VI[t.to_status];
    const body = [t.message, t.hint ? `Gợi ý: ${t.hint}` : ""].filter(Boolean).join("\n");
    out.push({
      kind,
      title: `${head}: ${labelOf(t.check_key)}`,
      body: body.slice(0, 2000),
      dedup_key: opsDedupKey(t.check_key, t.to_status, t.changed_at),
    });
  }
  return out;
}
