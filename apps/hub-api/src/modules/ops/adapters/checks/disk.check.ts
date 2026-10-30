// CR-104 · ops-checks · "Đĩa server": đọc `<statusDir>/host.json` (cron host 30 phút ghi `df`). Điểm gắn kết đầy nhất so ngưỡng
// (> warn warn, > crit crit). File thiếu/sai/cũ hơn 2 × tần suất kiểm ⇒ unknown (cron host có thể đã chết).
import { type OpsHostStatus, OpsHostStatusSchema } from "@ai/contracts/hub-admin";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { readStatusFile, type StatusFile, thresholds } from "./check-kit";

/** Cron host ghi 30 phút một lần ⇒ không coi là cũ trước 65 phút dù tần suất kiểm đặt thấp. */
export const DISK_MIN_STALE_MIN = 65;
const HINT =
  "Giải phóng đĩa trên host: `docker system prune`, xoá backup/log cũ (`du -sh /var/lib/docker /var/log`), hoặc mở rộng ổ.";
const HINT_CRON =
  "Cron ghi host.json không chạy: kiểm tra crontab trên host và script ops-status (README deploy).";

/** Thuần. `everyMin` = tần suất kiểm (cấu hình); file cũ hơn 2× ⇒ unknown. */
export function evaluateDisk(
  f: StatusFile<OpsHostStatus>,
  now: Date,
  everyMin: number,
  warn: number,
  crit: number,
): OpsCheckResult {
  if (f.kind === "missing")
    return {
      status: "unknown",
      message: "Chưa có file trạng thái host (host.json)",
      hint: HINT_CRON,
    };
  if (f.kind === "invalid")
    return {
      status: "unknown",
      message: `File host.json không hợp lệ: ${f.reason}`,
      hint: HINT_CRON,
    };
  const ageMin = (now.getTime() - Date.parse(f.data.at)) / 60_000;
  const staleMin = Math.max(2 * everyMin, 2 * (f.data.every_min ?? 0), DISK_MIN_STALE_MIN);
  if (ageMin > staleMin)
    return {
      status: "unknown",
      message: `host.json đã cũ ${Math.floor(ageMin)} phút (quá ${staleMin} phút)`,
      hint: HINT_CRON,
    };
  if (f.data.disks.length === 0)
    return { status: "unknown", message: "host.json không liệt kê đĩa nào", hint: HINT_CRON };
  const worst = f.data.disks.reduce((a, b) => (b.used_pct > a.used_pct ? b : a));
  const value = {
    used_pct: worst.used_pct,
    mount: worst.mount,
    disks: f.data.disks,
    deploy_ref: f.data.deploy_ref,
  };
  const msg = `Đĩa ${worst.mount} đã dùng ${worst.used_pct}%`;
  if (worst.used_pct > crit) return { status: "crit", value, message: msg, hint: HINT };
  if (worst.used_pct > warn) return { status: "warn", value, message: msg, hint: HINT };
  return { status: "ok", value, message: msg };
}

export const diskCheck: OpsCheck = {
  key: "disk",
  async run(d, cfg, all) {
    const t = thresholds("disk", cfg);
    const f = await readStatusFile(d, "host.json", OpsHostStatusSchema);
    return evaluateDisk(f, d.now, all.every_min, t.warn ?? 80, t.crit ?? 90);
  },
};
