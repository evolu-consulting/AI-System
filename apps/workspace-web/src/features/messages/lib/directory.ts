// CR-132b · luật thuần cột trái «Nhóm» + «Thành viên»: 1-1 chính là dòng của người đó (một khái niệm, một chỗ) — hội thoại 1-1 đã có thì dòng
// thành viên mang xem trước/chưa đọc; chưa có thì bấm vào sẽ mở/tạo. Lọc theo tên không dấu.
import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import { convTitle } from "./conversations";
import { foldText } from "./format";
import type { Person } from "./people";

export type MemberRow = { person: Person; conv: ConversationSummary | null };
export type Directory = { groups: ConversationSummary[]; members: MemberRow[] };

/** `items` đã sắp mới nhất trước. Thành viên có hội thoại lên trước (theo thứ tự đó), còn lại theo tên. Người bị khoá nhưng còn 1-1 cũ vẫn hiện (không tạo mới được từ danh bạ). */
export function buildDirectory(
  items: readonly ConversationSummary[],
  people: readonly Person[],
  q: string,
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
      rows.push({ person: { id, name: c.peer.name }, conv: c });
  const withConv = rows.filter((r) => r.conv).sort(byRecent(items));
  const without = rows
    .filter((r) => !r.conv)
    .sort((a, b) => a.person.name.localeCompare(b.person.name, "vi"));
  return { groups, members: [...withConv, ...without] };
}

const byRecent = (items: readonly ConversationSummary[]) => {
  const pos = new Map(items.map((c, i) => [c.id, i]));
  return (a: MemberRow, b: MemberRow) =>
    (pos.get(a.conv?.id ?? "") ?? 0) - (pos.get(b.conv?.id ?? "") ?? 0);
};
