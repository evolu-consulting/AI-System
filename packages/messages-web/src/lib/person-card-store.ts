// fix-review-r1 · kho thẻ người theo PHIÊN (tenant + user): đổi phiên ⇒ xoá sạch (không rò thẻ người của phiên trước sang phiên sau) và
// bỏ qua kết quả đang bay của phiên cũ. `version` tăng mỗi lần có thẻ mới / thẻ được làm mới / xoá — thay `store.size` (không đổi khi
// thẻ hết hạn rồi tải lại ⇒ giao diện giữ thẻ cũ). Thuần, không biết React; hook gắn qua `subscribe` + `version`.
import type { PersonCard } from "@ai/contracts/people";

export type CardStore = {
  /** Đặt phiên hiện tại ("" = chưa đăng nhập). Khác phiên trước ⇒ xoá thẻ + bỏ kết quả đang bay. Trả `true` nếu có xoá. */
  ensure(scope: string): boolean;
  /** Có thẻ còn hạn, hoặc đang đọc ở phiên này? */
  have(scope: string, id: string): boolean;
  get(scope: string, id: string): PersonCard | undefined;
  /** Đánh dấu đang đọc; trả mã lô (epoch) để `put`/`done` đối chiếu. */
  begin(scope: string, ids: readonly string[]): number;
  put(scope: string, epoch: number, cards: readonly PersonCard[]): void;
  done(scope: string, epoch: number, ids: readonly string[]): void;
  version(): number;
  subscribe(fn: () => void): () => void;
};

export function createCardStore(ttlMs: number, now: () => number = Date.now): CardStore {
  let cur = "";
  let epoch = 0;
  let ver = 0;
  let cards = new Map<string, { card: PersonCard; at: number }>();
  let inflight = new Set<string>();
  const subs = new Set<() => void>();
  const bump = () => {
    ver++;
    for (const f of subs) f();
  };
  const ensure = (scope: string): boolean => {
    if (scope === cur) return false;
    cur = scope;
    epoch++;
    cards = new Map();
    inflight = new Set();
    ver++; // không gọi subs ở đây: có thể đang trong lúc render
    return true;
  };
  return {
    ensure,
    have: (scope, id) => {
      ensure(scope);
      return inflight.has(id) || (cards.get(id)?.at ?? 0) > now() - ttlMs;
    },
    get: (scope, id) => {
      ensure(scope);
      return cards.get(id)?.card;
    },
    begin: (scope, ids) => {
      ensure(scope);
      for (const id of ids) inflight.add(id);
      return epoch;
    },
    put: (scope, e, list) => {
      if (scope !== cur || e !== epoch) return;
      for (const c of list) cards.set(c.user_id, { card: c, at: now() });
      bump();
    },
    done: (scope, e, ids) => {
      if (scope !== cur || e !== epoch) return;
      for (const id of ids) inflight.delete(id);
    },
    version: () => ver,
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
