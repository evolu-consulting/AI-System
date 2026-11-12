// CR-132 · W2 · luật thuần của khung chat: gộp các trang tin (trang đầu = mới nhất, mỗi trang tăng dần theo seq), áp tin mới / thu hồi,
// chia theo ngày, «Đã xem».
import type { ConversationMember, Message } from "@ai/contracts/pack-contracts";

export type MsgPages = {
  pages: { items: Message[]; has_more: boolean }[];
  pageParams?: unknown[];
};

/** Một danh sách tăng dần theo seq, bỏ trùng (cùng seq). */
export function flattenPages(data: MsgPages | undefined): Message[] {
  if (!data) return [];
  const seen = new Set<number>();
  const out: Message[] = [];
  for (const p of data.pages)
    for (const m of p.items)
      if (!seen.has(m.seq)) {
        seen.add(m.seq);
        out.push(m);
      }
  return out.sort((a, b) => a.seq - b.seq);
}

/** Seq của tin cũ nhất đã tải = tham số «tải thêm cũ» (hết ⇒ undefined). */
export function nextBefore(pages: MsgPages["pages"]): number | undefined {
  const last = pages[pages.length - 1];
  return last?.has_more && last.items[0] ? last.items[0].seq : undefined;
}

/** `msg.new` / kết quả gửi: thêm vào trang mới nhất nếu chưa có (theo seq). */
export function applyNewMessage(data: MsgPages | undefined, m: Message): MsgPages {
  if (!data || data.pages.length === 0) return { pages: [{ items: [m], has_more: false }] };
  if (flattenPages(data).some((x) => x.seq === m.seq)) return data;
  const [first, ...rest] = data.pages;
  if (!first) return data;
  return { ...data, pages: [{ ...first, items: [...first.items, m] }, ...rest] };
}

/** `msg.deleted` / thu hồi: tin rỗng, đánh dấu đã thu hồi. */
export function applyDeleted(data: MsgPages | undefined, seq: number): MsgPages | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((p) => ({
      ...p,
      items: p.items.map((m) => (m.seq === seq ? { ...m, body: "", files: [], deleted: true } : m)),
    })),
  };
}

/** Khoá ngày địa phương `YYYY-MM-DD` cho vạch ngày. */
export const dayKey = (iso: string): string => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export type DayGroup = { day: string; items: Message[] };
export function groupByDay(items: readonly Message[]): DayGroup[] {
  const out: DayGroup[] = [];
  for (const m of items) {
    const day = dayKey(m.at);
    const last = out[out.length - 1];
    if (last?.day === day) last.items.push(m);
    else out.push({ day, items: [m] });
  }
  return out;
}

export const lastMineSeq = (items: readonly Message[], myId: string): number | null => {
  for (let i = items.length - 1; i >= 0; i--) {
    const m = items[i];
    if (m && m.sender_id === myId && !m.deleted) return m.seq;
  }
  return null;
};

/** «Đã xem»: số người khác đã đọc tới tin cuối của mình (0 ⇒ không hiện). */
export function seenCount(
  mineSeq: number | null,
  members: readonly ConversationMember[],
  myId: string,
): number {
  if (mineSeq == null) return 0;
  return members.filter((x) => x.user_id !== myId && x.last_read_seq >= mineSeq).length;
}

/** `msg.read` của người khác ⇒ cập nhật mốc đọc trong chi tiết hội thoại (không lùi). */
export function applyReadToMembers(
  members: readonly ConversationMember[],
  userId: string,
  seq: number,
): ConversationMember[] {
  return members.map((m) =>
    m.user_id === userId && seq > m.last_read_seq ? { ...m, last_read_seq: seq } : m,
  );
}
