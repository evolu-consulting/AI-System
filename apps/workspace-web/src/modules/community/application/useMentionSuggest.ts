// CR-193 · «@» tại chỗ: danh sách thả gợi ý người ngay dưới ô đang gõ (bình luận + thân bài). Không hộp thoại, không ô tích.
import { type KeyboardEvent, useEffect, useState } from "react";
import { activeMention } from "../domain/thread";
import type { PeopleScope } from "./ports";
import { usePeople } from "./usePeople";

export type SuggestKey = { kind: "none" | "close" | "pick" } | { kind: "move"; index: number };

/** Phím ⇒ hành động trong danh sách thả (thuần, có unit test). Danh sách rỗng chỉ nhận Esc. */
export function suggestKey(key: string, count: number, index: number): SuggestKey {
  if (key === "Escape") return { kind: "close" };
  if (count === 0) return { kind: "none" };
  if (key === "ArrowDown") return { kind: "move", index: (index + 1) % count };
  if (key === "ArrowUp") return { kind: "move", index: (index - 1 + count) % count };
  if (key === "Enter" || key === "Tab") return { kind: "pick" };
  return { kind: "none" };
}

export type MentionAt = { start: number; query: string };

export function useMentionSuggest(scope: PeopleScope) {
  const [at, setAt] = useState<MentionAt | null>(null);
  const [index, setIndex] = useState(0);
  const { people, state } = usePeople(at !== null, at?.query ?? "", scope);
  const query = at?.query;
  // biome-ignore lint/correctness/useExhaustiveDependencies: chọn lại dòng đầu mỗi khi chữ tìm đổi
  useEffect(() => setIndex(0), [query]);
  const open = at !== null;
  return {
    at,
    open,
    people,
    state,
    index,
    setIndex,
    /** Gọi sau mỗi lần chữ/con trỏ đổi: đang gõ «@chữ» ⇒ mở, ngược lại đóng. */
    update: (text: string, caret: number) => setAt(activeMention(text, caret)),
    close: () => setAt(null),
    /** Phím mũi tên/Enter/Tab/Esc khi danh sách mở; trả true nếu đã xử lý (chặn Enter gửi). */
    onKeyDown: (e: KeyboardEvent, pick: (i: number) => void): boolean => {
      if (!open || e.nativeEvent.isComposing) return false;
      const act = suggestKey(e.key, people.length, index);
      if (act.kind === "none") return false;
      e.preventDefault();
      if (act.kind === "close") setAt(null);
      else if (act.kind === "move") setIndex(act.index);
      else pick(index);
      return true;
    },
  };
}
