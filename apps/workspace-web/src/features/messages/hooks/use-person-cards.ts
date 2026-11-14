// CR-148 · thẻ người (avatar, phòng ban, chức vụ) cho cả trang danh sách/khung chat: đọc THEO LÔ ≤ 50 id những người chưa có; lưu trong phiên
// (5 phút), không gọi từng người. Lỗi ⇒ không có thẻ (giao diện rơi về chữ cái đầu, vẫn dùng được).
import type { PersonCard } from "@ai/contracts/people";
import { useEffect, useMemo, useState } from "react";
import { fetchPersonCards } from "../api";
import { missingBatches } from "../lib/cards";

const TTL = 5 * 60_000;
const store = new Map<string, { card: PersonCard; at: number }>();
const inflight = new Set<string>();
const subs = new Set<() => void>();

export function usePersonCards(ids: readonly string[]): ReadonlyMap<string, PersonCard> {
  const [, bump] = useState(0);
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  useEffect(() => {
    const now = Date.now();
    const have = (id: string) => inflight.has(id) || (store.get(id)?.at ?? 0) > now - TTL;
    const batches = missingBatches(key ? key.split(",") : [], have);
    const poke = () => bump((n) => n + 1);
    subs.add(poke);
    for (const b of batches) {
      for (const id of b) inflight.add(id);
      fetchPersonCards(b)
        .then((cards) => {
          for (const c of cards) store.set(c.user_id, { card: c, at: Date.now() });
        })
        .catch(() => undefined)
        .finally(() => {
          for (const id of b) inflight.delete(id);
          for (const fn of subs) fn();
        });
    }
    return () => {
      subs.delete(poke);
    };
  }, [key]);
  const version = store.size; // thẻ mới về ⇒ tính lại
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` chỉ để kích hoạt tính lại
  return useMemo(() => {
    const m = new Map<string, PersonCard>();
    for (const id of key ? key.split(",") : []) {
      const e = store.get(id);
      if (e) m.set(id, e.card);
    }
    return m;
  }, [key, version]);
}
