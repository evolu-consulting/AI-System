// CR-104 · ops-checks · "Backup": đọc `<statusDir>/backup.json` (backup.sh ghi, O4). crit: thiếu file, bản mới nhất quá `crit` giờ
// hoặc ok=false; warn: chưa có bản sao ngoài máy (offsite=false) hoặc chép ngoài máy lỗi. File sai định dạng ⇒ unknown.
import { type OpsBackupStatus, OpsBackupStatusSchema } from "@ai/contracts/hub-admin";
import type { OpsCheck, OpsCheckResult } from "../../application/ops.check";
import { readStatusFile, type StatusFile, scrub, thresholds } from "./check-kit";

const HOUR_MS = 3_600_000;
const HINT_RUN =
  "Chạy backup thủ công trên host (`./backup.sh` trong thư mục deploy) và xem log cron; kiểm tra dung lượng đĩa.";
const HINT_OFFSITE =
  "Đặt `OFFSITE_DIR` trong .env (thư mục/ổ gắn ngoài máy) để backup.sh chép bản sao ra ngoài; kiểm tra ổ đích còn chỗ.";

/** Thuần. */
export function evaluateBackup(
  f: StatusFile<OpsBackupStatus>,
  now: Date,
  critHours: number,
): OpsCheckResult {
  if (f.kind === "missing")
    return {
      status: "crit",
      message: "Chưa có file trạng thái backup (backup.json)",
      hint: `${HINT_RUN} Kiểm tra cron backup đã chạy chưa.`,
    };
  if (f.kind === "invalid")
    return { status: "unknown", message: `File backup.json không hợp lệ: ${f.reason}` };
  const b = f.data;
  const ageH = (now.getTime() - Date.parse(b.finished_at)) / HOUR_MS;
  const value = {
    age_hours: Math.round(ageH * 10) / 10,
    ok: b.ok,
    size_bytes: b.size_bytes,
    offsite: b.offsite,
    offsite_ok: b.offsite_ok,
  };
  if (!b.ok)
    return {
      status: "crit",
      value,
      message: `Backup gần nhất thất bại${b.error ? `: ${scrub(b.error, 120)}` : ""}`,
      hint: HINT_RUN,
    };
  if (ageH > critHours)
    return {
      status: "crit",
      value,
      message: `Backup mới nhất đã ${Math.floor(ageH)} giờ trước (quá ${critHours} giờ)`,
      hint: HINT_RUN,
    };
  if (!b.offsite || b.offsite_ok === false)
    return {
      status: "warn",
      value,
      message: b.offsite
        ? "Chép backup ra ngoài máy bị lỗi"
        : "Chưa đặt OFFSITE_DIR — backup chỉ nằm trên máy",
      hint: HINT_OFFSITE,
    };
  return {
    status: "ok",
    value,
    message: `Backup ${Math.floor(ageH)} giờ trước, đã chép ra ngoài máy`,
  };
}

export const backupCheck: OpsCheck = {
  key: "backup",
  async run(d, cfg) {
    const f = await readStatusFile(d, "backup.json", OpsBackupStatusSchema);
    return evaluateBackup(f, d.now, thresholds("backup", cfg).crit ?? 26);
  },
};
