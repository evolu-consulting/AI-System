// CR-093 · làm nóng pool cho vòng nền (nhắc, hết hạn): lần ĐẦU một kết nối Postgres chạy câu lô, tiến trình backend phải
// nạp catalog (bảng, index, policy RLS) + chuẩn bị câu ⇒ +20–30 ms một lần mỗi kết nối. Khi mount, mở đồng thời `n` tx
// (rào chờ đủ `n` ⇒ mỗi tx giữ một kết nối khác nhau) và chạy mỗi câu lô một lần với lô RỖNG: không khoá, không ghi hàng
// nào (khoá `limit 0`, chèn từ mảng JSON rỗng), cùng các câu quét chỉ đọc của `sweepOnce` cũng `limit 0` (`limit` là
// tham số ⇒ cùng văn bản câu, không đọc hàng). Lỗi chỉ log — không chặn khởi động, không đổi hành vi nghiệp vụ.
import { withHubScope } from "@ai/db/hub-scope";
import { safeErrorFields } from "../../../lib/errors";
import { warmReviewTasks } from "../adapters/notify/review-tasks.repo";
import { warmTimerSweep } from "../adapters/timers/timer-sweep";
import type { ProcessBgDeps } from "../core/ports";
import { warmNotices } from "../notify/batch.repo";
import { warmExpire } from "./expire";
import { warmSweepQueries } from "./sweeps";

/** Trần số kết nối làm nóng (pool Hub mặc định 10). */
const WARM_MAX = 10;
/** Không giữ kết nối quá lâu nếu pool nhỏ hơn số tx (rào không bao giờ đủ). */
const GATE_TIMEOUT_MS = 2_000;

export async function warmBackgroundPool(d: ProcessBgDeps): Promise<void> {
  const n = Math.max(1, Math.min(WARM_MAX, d.db.max ?? 1));
  let arrived = 0;
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => {
    open = r;
  });
  const timer = setTimeout(open, GATE_TIMEOUT_MS);
  const one = () =>
    withHubScope(d.db, { kind: "system" }, async (tx) => {
      if (++arrived === n) open();
      await gate;
      await warmReviewTasks(tx);
      await warmNotices(tx);
      await warmExpire(tx);
      await warmSweepQueries(tx);
      await warmTimerSweep(tx);
    });
  try {
    await Promise.all(Array.from({ length: n }, one));
  } catch (err) {
    d.log.warn("process-warm-failed", safeErrorFields(err));
  } finally {
    clearTimeout(timer);
  }
}
