// CR-132 · W2 · nhãn giờ/ngày thuần (truyền `now` để test): danh sách = giờ nếu hôm nay, còn lại ngày/tháng; vạch ngày = Hôm nay / Hôm qua / ngày.
import { dayKey } from "./message-pages";

const DAY_MS = 86_400_000;

/** Giờ-phút địa phương `HH:mm`. */
export const timeLabel = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const dmy = (iso: string): string => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
};

/** Nhãn giờ ở danh sách: hôm nay ⇒ `HH:mm`, khác ⇒ `dd/MM/yyyy`. */
export const listTime = (iso: string, now: Date = new Date()): string =>
  dayKey(iso) === dayKey(now.toISOString()) ? timeLabel(iso) : dmy(iso);

/** Vạch ngày: `today` / `yesterday` / ngày đầy đủ (câu chữ do component dịch). */
export function dayLabel(
  iso: string,
  now: Date = new Date(),
): { kind: "today" | "yesterday" | "date"; text: string } {
  const k = dayKey(iso);
  if (k === dayKey(now.toISOString())) return { kind: "today", text: "" };
  if (k === dayKey(new Date(now.getTime() - DAY_MS).toISOString()))
    return { kind: "yesterday", text: "" };
  return { kind: "date", text: dmy(iso) };
}

/** Chữ cái đầu cho avatar. */
export const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase() || "?";

const MARKS = /[\u0300-\u036f]/g;
/** So khớp tên không phân biệt hoa thường và dấu tiếng Việt (đ ⇒ d). */
export const foldText = (s: string): string =>
  s.toLowerCase().normalize("NFD").replace(MARKS, "").replace(/đ/g, "d");
