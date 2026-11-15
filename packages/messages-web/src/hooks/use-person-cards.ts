// CR-148 · thẻ người (avatar, phòng ban, chức vụ) cho cả trang danh sách/khung chat: đọc THEO LÔ ≤ 50 id những người chưa có; lưu trong phiên
// (5 phút), không gọi từng người. Lỗi ⇒ không có thẻ (giao diện rơi về chữ cái đầu, vẫn dùng được).
// fix-review-r1 · kho theo phiên (tenant + user, xoá khi đổi phiên) + bộ đếm phiên bản (`lib/person-card-store.ts`).
import type { PersonCard } from "@ai/contracts/people";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { fetchPersonCards } from "../api";
import { messagesHost } from "../host";
import { missingBatches } from "../lib/cards";
import { createCardStore } from "../lib/person-card-store";

const store = createCardStore(5 * 60_000);

export function usePersonCards(ids: readonly string[]): ReadonlyMap<string, PersonCard> {
  const scope = messagesHost().useScope();
  store.ensure(scope); // idempotent: đổi phiên ⇒ kho trống TRƯỚC khi đọc version/thẻ
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const version = useSyncExternalStore(store.subscribe, store.version, store.version);
  useEffect(() => {
    if (!scope) return;
    const batches = missingBatches(key ? key.split(",") : [], (id) => store.have(scope, id));
    for (const b of batches) {
      const epoch = store.begin(scope, b);
      fetchPersonCards(b)
        .then((cards) => store.put(scope, epoch, cards))
        .catch(() => undefined)
        .finally(() => store.done(scope, epoch, b));
    }
  }, [key, scope]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` chỉ để kích hoạt tính lại khi thẻ mới về / phiên đổi
  return useMemo(() => {
    const m = new Map<string, PersonCard>();
    if (!scope) return m;
    for (const id of key ? key.split(",") : []) {
      const c = store.get(scope, id);
      if (c) m.set(id, c);
    }
    return m;
  }, [key, scope, version]);
}
