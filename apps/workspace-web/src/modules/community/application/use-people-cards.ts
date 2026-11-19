// CR-191 · BR-191-13 · thẻ người (ảnh thật) cho tác giả bài bảng tin: đọc THEO LÔ ≤ 50 id chưa có qua `api.getPeople` (`GET /people?ids=`, gồm cả
// người công ty đã kết nối). Lỗi ⇒ không có thẻ (avatar rơi về chữ cái đầu, vẫn dùng được).
import type { PersonCard } from "@ai/contracts/people";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./ctx";

const BATCH = 50;

export function usePeopleCards(ids: readonly string[]): ReadonlyMap<string, PersonCard> {
  const { api } = useApp();
  const [cards, setCards] = useState<ReadonlyMap<string, PersonCard>>(new Map());
  const asked = useRef(new Set<string>());
  const key = [...new Set(ids)].sort().join(",");
  useEffect(() => {
    const todo = (key ? key.split(",") : []).filter((id) => !asked.current.has(id));
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      for (const id of batch) asked.current.add(id);
      api.getPeople(batch).then(
        (r) => setCards((m) => new Map([...m, ...r.items.map((c) => [c.user_id, c] as const)])),
        () => {
          for (const id of batch) asked.current.delete(id);
        },
      );
    }
  }, [key, api]);
  return cards;
}
