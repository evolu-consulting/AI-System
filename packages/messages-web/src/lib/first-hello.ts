// CR-190 · khung chat trống: 3 câu chào gợi ý (bấm là gửi) + khi nào hiện «Gửi lời chào đầu tiên» + chữ nhãn ngày dính.
import { dayLabel } from "./format";

/** Khoá i18n 3 câu chào gợi ý (thứ tự cố định). */
export const HELLO_KEYS = [
  "contracts.messages.hello.g1",
  "contracts.messages.hello.g2",
  "contracts.messages.hello.g3",
] as const;

/** Cuộc chưa có tin nào (kể cả tin đang gửi) và đã tải xong ⇒ màn «Gửi lời chào đầu tiên». */
export const isFirstHello = (loaded: boolean, sent: number, outgoing: number): boolean =>
  loaded && sent === 0 && outgoing === 0;

/** Nhãn ngày dính đầu khung: Hôm nay / Hôm qua / ngày đầy đủ. */
export function dayBarText(
  iso: string,
  words: { today: string; yesterday: string },
  now: Date = new Date(),
): string {
  const d = dayLabel(iso, now);
  return d.kind === "today" ? words.today : d.kind === "yesterday" ? words.yesterday : d.text;
}
