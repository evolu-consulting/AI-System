// CR-136 · luật thuần ghép «tin đang gửi» với tin thật theo `client_id`: MỘT dòng cho mỗi tin, cùng khoá (client_id) trước/sau khi server xác nhận
// ⇒ React giữ nguyên phần tử (không remount, không nháy); tin đang gửi nằm CÙNG nhóm ngày với tin thật ⇒ không đổi cha khi được thay.
import type { Message } from "@ai/contracts/pack-contracts";
import { dayKey } from "./message-pages";

export type PendingMsg = {
  clientId: string;
  body: string;
  fileNames: readonly string[];
  /** Khoá i18n lý do lỗi; null = đang gửi. */
  failed: string | null;
};

export type Row =
  | { kind: "sent"; key: string; m: Message }
  | { kind: "pending"; key: string; p: PendingMsg };
export type DayRows = { day: string; rows: Row[] };

/** `items` tăng dần theo seq. Tin đang gửi mà server đã có (cùng client_id — vd sự kiện `msg.new` tới trước kết quả POST) bị bỏ, tin thật thế chỗ cùng khoá. */
export function mergeRows(
  items: readonly Message[],
  pending: readonly PendingMsg[],
  today: string,
): DayRows[] {
  const out: DayRows[] = [];
  const push = (day: string, row: Row) => {
    const last = out[out.length - 1];
    if (last?.day === day) last.rows.push(row);
    else out.push({ day, rows: [row] });
  };
  const known = new Set(items.map((m) => m.client_id));
  for (const m of items) push(dayKey(m.at), { kind: "sent", key: m.client_id, m });
  for (const p of pending)
    if (!known.has(p.clientId)) push(today, { kind: "pending", key: p.clientId, p });
  return out;
}

export type SendState = "sent" | "sending" | "failed";
export const stateOf = (r: Row): SendState =>
  r.kind === "sent" ? "sent" : r.p.failed ? "failed" : "sending";
