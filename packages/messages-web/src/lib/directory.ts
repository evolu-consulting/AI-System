// CR-132b + CR-148 · luật thuần cột trái «Nhóm» + «Thành viên»: 1-1 chính là dòng của người đó (một khái niệm, một chỗ) — hội thoại 1-1 đã có thì dòng
// thành viên mang xem trước/chưa đọc; chưa có thì bấm vào sẽ mở/tạo. «Thành viên» chia nhóm theo phòng ban (người không phòng ⇒ «Chưa có phòng», cuối).
// Lọc theo tên không dấu.
import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import { convTitle } from "./conversations";
import { foldText } from "./format";
import type { Dept, Person } from "./people";

export type MemberRow = { person: Person; conv: ConversationSummary | null };
export type DeptSection = { key: string; name: string | null; rows: MemberRow[] };
export type Directory = { groups: ConversationSummary[]; sections: DeptSection[] };

export const NO_DEPT_KEY = "none";

/**
 * `items` đã sắp mới nhất trước. Trong mỗi phòng: người có hội thoại lên trước (theo thứ tự đó), còn lại theo tên. Phòng sắp theo tên, «Chưa có phòng» cuối.
 * Người bị khoá nhưng còn 1-1 cũ vẫn hiện (không tạo mới được từ danh bạ); phòng của họ lấy từ `deptOf` (thẻ người), không có ⇒ «Chưa có phòng».
 */
/** Trong một phòng: người có hội thoại trước (theo mới nhất), còn lại theo tên. */
const rowOrder = (pos: ReadonlyMap<string, number>) => (a: MemberRow, b: MemberRow) => {
  if (a.conv && b.conv) return (pos.get(a.conv.id) ?? 0) - (pos.get(b.conv.id) ?? 0);
  if (a.conv || b.conv) return a.conv ? -1 : 1;
  return a.person.name.localeCompare(b.person.name, "vi");
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: một luật thuần (lọc → hàng → nhóm phòng), tách ra làm mất mạch
export function buildDirectory(
  items: readonly ConversationSummary[],
  people: readonly Person[],
  q: string,
  deptOf: (id: string) => Dept | null | undefined = () => null,
): Directory {
  const needle = foldText(q.trim());
  const match = (name: string) => !needle || foldText(name).includes(needle);
  const groups = items.filter((c) => c.kind === "group" && match(convTitle(c)));
  const dmByPeer = new Map<string, ConversationSummary>();
  for (const c of items)
    if (c.kind === "direct" && c.peer && !dmByPeer.has(c.peer.id)) dmByPeer.set(c.peer.id, c);
  const rows: MemberRow[] = people
    .filter((p) => match(p.name))
    .map((p) => ({ person: p, conv: dmByPeer.get(p.id) ?? null }));
  const known = new Set(people.map((p) => p.id));
  for (const [id, c] of dmByPeer)
    if (!known.has(id) && c.peer && match(c.peer.name))
      rows.push({
        person: { id, name: c.peer.name, department: deptOf(id) ?? null },
        conv: c,
      });
  const pos = new Map(items.map((c, i) => [c.id, i]));
  const within = rowOrder(pos);
  const by = new Map<string, DeptSection>();
  for (const r of rows) {
    const d = r.person.department ?? null;
    const key = d ? d.id : NO_DEPT_KEY;
    const s = by.get(key) ?? { key, name: d ? d.name : null, rows: [] };
    by.set(key, s);
    s.rows.push(r);
  }
  const sections = [...by.values()].sort((a, b) =>
    a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name, "vi"),
  );
  for (const s of sections) s.rows.sort(within);
  return { groups, sections };
}
