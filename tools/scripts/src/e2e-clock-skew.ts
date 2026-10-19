// TS1 · preload cho admin-api của e2e (`bun --preload`): đồng hồ máy chủ = giờ thật + độ lệch đọc từ file `E2E_CLOCK_FILE`
// (mili giây, ghi bởi `e2e/support/totp.ts: waitNextStep`). Nhờ đó spec 2FA sang "bước TOTP kế tiếp" bằng cách dịch đồng hồ
// máy chủ ngay (tín hiệu), thay vì chờ tới 30 s thật mỗi lần (Luật 4c: không ngủ chờ). Không có `E2E_CLOCK_FILE` ⇒ không làm gì.
// Chỉ nạp cho tiến trình e2e; không nằm trong mã sản phẩm. Khởi động đặt lại độ lệch về 0.
import { readFileSync, writeFileSync } from "node:fs";

const file = process.env.E2E_CLOCK_FILE;

if (file) {
  writeFileSync(file, "0");
  const RealDate = Date;
  const skewMs = (): number => {
    try {
      return Number(readFileSync(file, "utf8")) || 0;
    } catch {
      return 0;
    }
  };
  // Proxy giữ nguyên prototype (`instanceof Date`, `Date()` dạng hàm) — chỉ `new Date()` không đối số và `Date.now()` lệch.
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) =>
      Reflect.construct(target, args.length ? args : [RealDate.now() + skewMs()], newTarget),
    get: (target, prop, receiver) =>
      prop === "now" ? () => RealDate.now() + skewMs() : Reflect.get(target, prop, receiver),
  });
}
