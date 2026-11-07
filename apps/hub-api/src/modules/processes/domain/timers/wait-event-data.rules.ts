// CR-125 · m9 · dữ liệu kèm sự kiện (gói bắn `signalEvent(…, data)`, vd Ký số: thời điểm ký / người ký / mã phong bì; Gửi đối tác:
// lý do / lần gửi) ⇒ trường output của stage chờ. Luật thuần, lớp 1: chỉ nhận khoá snake_case + giá trị vô hướng có trần; KHÔNG ghi đè
// `event` (khoá rẽ nhánh); chỉ áp khi sự kiện mang dữ liệu là sự kiện THẮNG của stage (dữ liệu của sự kiện khác không lẫn vào).
import { WAIT_EVENT_FIELD } from "./wait-event-branch.rules";

export type EventData = Readonly<Record<string, string | number>>;
export type WaitSignal = { event: string; data: EventData };

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/;
export const EVENT_DATA_MAX_KEYS = 16;
export const EVENT_DATA_MAX_CHARS = 500;

/** Khoá/giá trị hợp lệ (bỏ phần sai, không ném); chuỗi cắt trần; số phải hữu hạn. */
export function cleanEventData(data: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (typeof data !== "object" || data === null || Array.isArray(data)) return out;
  for (const [k, v] of Object.entries(data)) {
    if (Object.keys(out).length >= EVENT_DATA_MAX_KEYS) break;
    if (!KEY_RE.test(k) || k === WAIT_EVENT_FIELD) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string" && v.trim() !== "")
      out[k] = v.trim().slice(0, EVENT_DATA_MAX_CHARS);
  }
  return out;
}

/** Trường output stage chờ: `event` = sự kiện thắng; dữ liệu kèm chỉ khi đúng sự kiện thắng. */
export function waitEventFields(
  won: string,
  signal: WaitSignal | undefined,
): Record<string, string | number> {
  const extra = signal && signal.event === won ? cleanEventData(signal.data) : {};
  return { ...extra, [WAIT_EVENT_FIELD]: won };
}
