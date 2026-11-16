// CR-178 · luật thuần hộp «Nhắn tin mới»: hai tab («Công ty mình» chọn nhiều ⇒ nhóm, «Đối tác» chọn 1 ⇒ nhắn riêng) và yêu cầu tạo cuộc. Nhóm chỉ nội bộ.
import {
  type CreateConversationRequest,
  MSG_GROUP_MAX,
  type MsgPerson,
} from "@ai/contracts/pack-contracts";
import { pickMode } from "./people";

export type NewChatTab = "own" | "partner";

/** Bấm một người: nội bộ ⇒ thêm/bớt (tối đa chính mình + 49); đối tác ⇒ chỉ một người (bấm người khác thì thay, bấm lại thì bỏ). */
export function toggleSelection(sel: readonly string[], id: string, tab: NewChatTab): string[] {
  if (tab === "partner") return sel.includes(id) ? [] : [id];
  if (sel.includes(id)) return sel.filter((x) => x !== id);
  return sel.length >= MSG_GROUP_MAX - 1 ? [...sel] : [...sel, id];
}

/** «Tên nhóm» bắt buộc khi chọn ≥ 2 người nội bộ. */
export const needsGroupName = (tab: NewChatTab, n: number): boolean => tab === "own" && n >= 2;

export type NewChatPlan =
  | { ok: true; body: CreateConversationRequest }
  | { ok: false; reason: "none" | "name" };

/** Yêu cầu tạo cuộc từ lựa chọn; chưa chọn ai ⇒ `none`, nhóm thiếu tên ⇒ `name`. */
export function planNewChat(
  tab: NewChatTab,
  ids: readonly string[],
  title: string,
  partner: MsgPerson | null,
): NewChatPlan {
  const first = ids[0];
  if (!first) return { ok: false, reason: "none" };
  if (tab === "partner") {
    if (!partner) return { ok: false, reason: "none" };
    return {
      ok: true,
      body: { kind: "partner", tenant_id: partner.company.id, user_id: partner.id },
    };
  }
  if (pickMode(ids.length) === "direct")
    return { ok: true, body: { kind: "direct", user_id: first } };
  if (title.trim() === "") return { ok: false, reason: "name" };
  return { ok: true, body: { kind: "group", title: title.trim(), member_ids: [...ids] } };
}

export type DeptBlock = { key: string; name: string | null; people: MsgPerson[] };

/** Gom người theo phòng ban (tên A→Z, «Chưa có phòng» cuối); trong phòng giữ thứ tự nhận về. */
export function groupByDept(people: readonly MsgPerson[]): DeptBlock[] {
  const by = new Map<string, DeptBlock>();
  for (const p of people) {
    const key = p.department?.id ?? "none";
    const b = by.get(key) ?? { key, name: p.department?.name ?? null, people: [] };
    by.set(key, b);
    b.people.push(p);
  }
  return [...by.values()].sort((a, b) =>
    a.name === null ? 1 : b.name === null ? -1 : a.name.localeCompare(b.name, "vi"),
  );
}
