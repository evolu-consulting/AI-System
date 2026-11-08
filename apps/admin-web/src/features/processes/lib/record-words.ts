// CR-125 · c6 · B4: tên "bản ghi" của flow (hợp đồng / bài đăng / đơn tham gia…) đọc từ `record.label` của SỰ KIỆN trong manifest,
// không còn chữ "hợp đồng" cứng trong câu của trình sửa. Thuần; vắng sự kiện/bản ghi ⇒ chữ hợp đồng (flow cũ theo khe).
import type { AppEventDecl } from "@ai/contracts/app-manifest";

type Lang = "vi" | "en";
type Label = { vi: string; en: string };

const FALLBACK: Label = { vi: "Hợp đồng", en: "Contract" };

/** `record` = viết thường (giữa câu: "hợp đồng gửi…"); `Record` = viết hoa đầu (đầu câu: "Hợp đồng chờ quá…"). */
export type RecordWords = { record: string; Record: string };

const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function recordWords(label: Label | undefined, lang: Lang): RecordWords {
  const raw = (label ?? FALLBACK)[lang] || (label ?? FALLBACK).vi;
  return { record: raw.toLowerCase(), Record: cap(raw.toLowerCase()) };
}

export const recordWordsOf = (ev: AppEventDecl | undefined, lang: Lang): RecordWords =>
  recordWords(ev?.record?.label, lang);

/** Nhiều bản ghi (công ty chạy flow của nhiều app): "Hợp đồng và bài đăng" — không trùng, giữ thứ tự gặp. */
export function joinRecordWords(labels: readonly (Label | undefined)[], lang: Lang): RecordWords {
  const uniq = [...new Set(labels.map((l) => recordWords(l, lang).record))];
  const words = uniq.length > 0 ? uniq : [recordWords(undefined, lang).record];
  const text =
    words.length === 1
      ? (words[0] ?? "")
      : `${words.slice(0, -1).join(", ")} ${lang === "vi" ? "và" : "and"} ${words.at(-1)}`;
  return { record: text, Record: cap(text) };
}
