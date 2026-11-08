// CR-125 · cr125-fix-bottomnav · chọn mục cho thanh dưới điện thoại (thuần, test được): theo cờ `mobile` của mục nav.
// `primary` đứng trước, mục thường theo sau (giữ thứ tự menu), `more` / `bottom:false` không chiếm cột; cắt theo `max`.
import type { NavEntry } from "~/shared/kernel/module-manifest";

export function pickBottomItems<T extends NavEntry>(all: readonly T[], max: number): T[] {
  const ok = all.filter((n) => n.bottom !== false && n.mobile !== "more");
  const primary = ok.filter((n) => n.mobile === "primary");
  const rest = ok.filter((n) => n.mobile !== "primary");
  return [...primary, ...rest].slice(0, max);
}
