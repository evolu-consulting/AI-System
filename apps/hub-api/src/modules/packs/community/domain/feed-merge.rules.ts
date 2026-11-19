// CR-191 · BR-191-1/2 · trộn bảng tin GỘP: hai nguồn đã sắp (created_at, id) DESC (bài công ty mình dưới RLS + bài công ty đã kết nối qua
// hàm DEFINER), mỗi nguồn xin `limit + 1` ⇒ lấy `limit` mới nhất; còn dư ⇒ có trang sau. Khoá keyset toàn cục (created_at, id) nên con trỏ
// một cặp dùng chung cho cả hai nguồn. Thời điểm so tới micro giây (Postgres) — `Date` chỉ tới mili giây nên tự tách phần lẻ.

export type FeedKeyed = { created_at: string; id: string };
export type Sourced<A, B> = { src: "own"; row: A } | { src: "connected"; row: B };

/** Micro giây kể từ epoch của chuỗi thời điểm ISO/Postgres (`…T10:00:00.123456+00:00`, `…Z`). */
export function microOf(s: string): number {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(s);
  if (!m) return Date.parse(s) * 1000;
  const base = Date.parse(`${m[1]}${m[3] || "Z"}`);
  return base * 1000 + Number((m[2] ?? "").padEnd(6, "0").slice(0, 6));
}

/** a mới hơn b theo (created_at, id) DESC (uuid chữ thường so như Postgres). */
export function newer(a: FeedKeyed, b: FeedKeyed): boolean {
  const d = microOf(a.created_at) - microOf(b.created_at);
  return d !== 0 ? d > 0 : a.id.toLowerCase() > b.id.toLowerCase();
}

export function mergeNewest<A extends FeedKeyed, B extends FeedKeyed>(
  own: readonly A[],
  connected: readonly B[],
  limit: number,
): { items: Sourced<A, B>[]; more: boolean } {
  const out: Sourced<A, B>[] = [];
  let i = 0;
  let j = 0;
  while (out.length < limit && (i < own.length || j < connected.length)) {
    const a = own[i];
    const b = connected[j];
    if (a && (!b || newer(a, b))) {
      out.push({ src: "own", row: a });
      i++;
    } else if (b) {
      out.push({ src: "connected", row: b });
      j++;
    }
  }
  return { items: out, more: own.length - i + (connected.length - j) > 0 };
}
