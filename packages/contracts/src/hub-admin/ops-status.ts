// CR-104 · ops-checks · định dạng file trạng thái do host ghi (O4: `backup.sh` → backup.json, cron 30 phút → host.json) và hub-api
// đọc (chỉ đọc). File sai định dạng ⇒ check trả `unknown` + thông điệp, không làm hỏng lượt kiểm.
import { z } from "zod";

const Iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "thời điểm ISO không hợp lệ");

/** `<statusDir>/backup.json` */
export const OpsBackupStatusSchema = z.object({
  finished_at: Iso,
  ok: z.boolean(),
  dir: z.string().max(500),
  size_bytes: z.number().min(0),
  offsite: z.boolean(),
  offsite_ok: z.boolean().nullable(),
  error: z.string().max(2000).nullable(),
});
export type OpsBackupStatus = z.infer<typeof OpsBackupStatusSchema>;

/** `<statusDir>/host.json` */
export const OpsHostStatusSchema = z.object({
  at: Iso,
  disks: z
    .array(
      z.object({
        mount: z.string().min(1).max(200),
        used_pct: z.number().min(0).max(100),
        avail_bytes: z.number().min(0),
      }),
    )
    .max(50),
  deploy_ref: z.string().max(200).nullable(),
  /** Tuỳ chọn: chu kỳ cron host (phút) — nếu có, ngưỡng "cũ" của check đĩa ≥ 2× giá trị này. */
  every_min: z.number().int().min(1).max(1440).optional(),
});
export type OpsHostStatus = z.infer<typeof OpsHostStatusSchema>;
