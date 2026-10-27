// esign-sweep · luật thuần vòng nền bước Ký số (lớp 1, chỉ builtin): kẹt `sending` quá hạn ⇒ cần quyết SEND_FAILED; phong bì `sent`
// chưa xong ⇒ nhắc người ký mỗi `remind_every_h` giờ kể từ lần gửi (`esign_at`) hoặc lần nhắc trước; quá `due_h` giờ kể từ lần gửi ⇒
// chuyển cấp MỘT lần cho lần gửi đó (mốc chuyển cấp cũ hơn `esign_at` ⇒ của lần gửi trước, không tính). Câu quét SQL
// (`adapters/esign-sweep.repo.ts`) viết lại đúng các vị từ này — sửa một chỗ phải sửa cả hai.

const H = 3_600_000;

export type EsignOpenRow = {
  status: "sending" | "sent";
  /** Lúc claim (`sending`) / lúc gửi xong (`sent`). */
  at: Date;
  remindedAt: Date | null;
  escalatedAt: Date | null;
  due_h: number;
  remind_every_h: number | null;
};
export type EsignDue = { stale: boolean; remind: boolean; overdue: boolean };

/** Hàng đến hạn gì lúc `now` (`staleMin` = `ESIGN_SENDING_STALE_MIN`). */
export function esignDueOf(r: EsignOpenRow, now: Date, staleMin: number): EsignDue {
  const t = now.getTime();
  const at = r.at.getTime();
  if (r.status === "sending")
    return { stale: at < t - staleMin * 60_000, remind: false, overdue: false };
  const last = Math.max(at, r.remindedAt?.getTime() ?? at);
  const remind =
    r.remind_every_h !== null && r.remind_every_h > 0 && last + r.remind_every_h * H <= t;
  const escalatedNow = r.escalatedAt !== null && r.escalatedAt.getTime() >= at;
  const overdue = !escalatedNow && at + r.due_h * H <= t;
  return { stale: false, remind, overdue };
}
