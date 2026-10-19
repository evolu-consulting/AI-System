// ADM-NFR-06 · helper `cn()` chuẩn shadcn: gộp class, class Tailwind sau thắng class trước.
// HD9 (D-02): khai các cỡ chữ tuỳ biến của theme (`--text-*` trong globals.css) là nhóm font-size — thiếu khai, tailwind-merge
// coi `text-label` cùng nhóm màu với `text-dim` và BỎ mất cỡ chữ (ô Stat/nút "Cột" ra 16 px thay vì 13 px như mgmt-app).
import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["micro", "caption", "label", "body", "kpi", "display"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
