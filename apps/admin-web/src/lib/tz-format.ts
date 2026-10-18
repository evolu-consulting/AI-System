// ADM-FR-72 · P-d1 · FD5: nhãn chênh lệch UTC của múi giờ + lựa chọn cho RefPicker. Thuần: thời điểm là tham số.
/** `"UTC+07:00"`; múi giờ lạ / thời điểm hỏng ⇒ "". */
export function utcOffsetLabel(timeZone: string, atIso: string): string {
  const ms = Date.parse(atIso);
  if (Number.isNaN(ms)) return "";
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(new Date(ms));
  } catch (e) {
    if (e instanceof RangeError) return "";
    throw e;
  }
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const local = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second"));
  const min = Math.round((local - Math.floor(ms / 1000) * 1000) / 60000);
  const a = Math.abs(min);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `UTC${min < 0 ? "-" : "+"}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

export function timeZoneOptions(
  zones: readonly string[],
  atIso: string,
): { id: string; label: string; hint: string }[] {
  return zones.map((id) => ({ id, label: id, hint: utcOffsetLabel(id, atIso) }));
}
