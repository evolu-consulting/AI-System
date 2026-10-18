// HUB-FR-143 · P-d1 · FD7: định dạng ngày hẹn theo múi giờ server trả. vi `DD/MM/YYYY HH:mm`, en `YYYY-MM-DD HH:mm`.
// Thuần: thời điểm là tham số; múi giờ lạ với trình duyệt (RangeError) ⇒ UTC; ISO hỏng ⇒ "".
export type WaitLang = "vi" | "en";

type Parts = { y: string; mo: string; d: string; h: string; mi: string };

function partsIn(iso: string, timeZone: string): Parts | null {
  if (Number.isNaN(Date.parse(iso))) return null;
  const make = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(iso));
  let list: Intl.DateTimeFormatPart[];
  try {
    list = make(timeZone);
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    list = make("UTC");
  }
  const get = (type: string) => list.find((p) => p.type === type)?.value ?? "";
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

const dateOf = (p: Parts, lang: WaitLang) =>
  lang === "vi" ? `${p.d}/${p.mo}/${p.y}` : `${p.y}-${p.mo}-${p.d}`;

/** Chỉ ngày (vi `DD/MM/YYYY`, en `YYYY-MM-DD`). */
export function formatWaitDate(iso: string, timeZone: string, lang: WaitLang): string {
  const p = partsIn(iso, timeZone);
  return p ? dateOf(p, lang) : "";
}

/** Ngày + giờ (vi `DD/MM/YYYY HH:mm`, en `YYYY-MM-DD HH:mm`). */
export function formatWaitDateTime(iso: string, timeZone: string, lang: WaitLang): string {
  const p = partsIn(iso, timeZone);
  return p ? `${dateOf(p, lang)} ${p.h}:${p.mi}` : "";
}

/** Chỉ `HH:mm` (giờ thử lại theo múi giờ máy người xem do người gọi truyền). `lang` giữ cho chữ ký đồng nhất. */
export function formatClock(iso: string, timeZone: string, _lang: WaitLang): string {
  const p = partsIn(iso, timeZone);
  return p ? `${p.h}:${p.mi}` : "";
}
