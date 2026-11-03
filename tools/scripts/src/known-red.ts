// Phần I/O của danh sách đỏ đã biết: đọc `tests/known-red.json`, in tóm tắt "đỏ MỚI" riêng với "đỏ cũ", trả mã thoát.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  exitCode,
  formatSplit,
  type KnownRed,
  parseKnownRed,
  type Red,
  splitReds,
} from "./known-red.rules";

export const KNOWN_RED_FILE = "tests/known-red.json";

export function loadKnownRed(root: string): KnownRed[] {
  const path = join(root, KNOWN_RED_FILE);
  return existsSync(path) ? parseKnownRed(readFileSync(path, "utf8")) : [];
}

/** Hôm nay (giờ máy) dạng `YYYY-MM-DD`. */
export const todayIso = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** In tóm tắt đỏ (mới trước, cũ sau) và trả mã thoát (0/1) theo chế độ quarantine. */
export function reportReds(o: {
  root: string;
  label: string;
  reds: readonly Red[];
  /** Số lượt chạy đỏ mà không rút được tên ca. */
  unattributed: number;
  quarantine: boolean;
}): number {
  const split = splitReds(o.reds, loadKnownRed(o.root), todayIso());
  for (const l of formatSplit(o.label, split, o.unattributed)) console.log(l);
  return exitCode(split, o.unattributed, o.quarantine);
}
