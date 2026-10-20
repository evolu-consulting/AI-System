// W1 · "Mua hàng": bộ nhớ đệm dữ liệu THÔ (HĐ + phụ lục + dòng hàng + lựa chọn) THEO TENANT, trong tiến trình (LRU nhỏ), khoá bằng
// "dấu vân tay" dữ liệu (số HĐ đã duyệt + `updated_at` lớn nhất + tổng `version` + số/ngày lựa chọn nguồn) và ngày lịch. KHÔNG nhớ dòng
// giá đã dựng cho cả tenant: dòng giá phụ thuộc người xem (phụ lục ẩn không được thay giá HĐ gốc — W1 review B #9), nên mỗi người xem
// lọc dữ liệu thô theo tập HĐ mình thấy rồi mới dựng; kết quả dựng nhớ theo tập thấy đó (`views`, vài tập mỗi mục).
// Nhiều request cùng lúc khi trượt dùng chung MỘT lần nạp — khoá theo `tenant|dấu vân tay|ngày` (review B #17: request mang dấu vân tay
// mới không nhập vào lượt nạp cũ, giữ đọc-được-điều-mình-vừa-ghi).
import type { FullSale, RawSourcing } from "../domain/sourcing.rules";

export type SourcingEntry = {
  fp: string;
  today: string;
  raw: RawSourcing;
  /** Dòng bán đã dựng theo tập HĐ thấy (khoá = id đã sắp, nối). */
  views: Map<string, FullSale[]>;
};

export type SourcingCache = {
  get(tenantId: string): SourcingEntry | undefined;
  fill(
    tenantId: string,
    key: { fp: string; today: string },
    load: () => Promise<SourcingEntry>,
  ): Promise<SourcingEntry>;
};

export const VIEWS_MAX = 8;

/** Dòng bán của một tập thấy: trúng thì dùng lại, trượt thì dựng (`build`) và nhớ (LRU `VIEWS_MAX`). */
export function viewOf(
  e: SourcingEntry,
  ids: readonly string[],
  build: () => FullSale[],
): FullSale[] {
  const k = [...ids].sort().join(",");
  const hit = e.views.get(k);
  if (hit) return hit;
  const rows = build();
  e.views.set(k, rows);
  if (e.views.size > VIEWS_MAX) e.views.delete(e.views.keys().next().value as string);
  return rows;
}

export function createSourcingCache(max = 16): SourcingCache {
  const store = new Map<string, SourcingEntry>();
  const inflight = new Map<string, Promise<SourcingEntry>>();
  const keep = (tenantId: string, e: SourcingEntry) => {
    store.delete(tenantId);
    store.set(tenantId, e);
    if (store.size > max) store.delete(store.keys().next().value as string);
  };
  return {
    get(tenantId) {
      const e = store.get(tenantId);
      if (e) keep(tenantId, e); // LRU: đưa lên cuối
      return e;
    },
    fill(tenantId, key, load) {
      const k = `${tenantId}|${key.fp}|${key.today}`;
      let p = inflight.get(k);
      if (!p) {
        p = load()
          .then((e) => {
            keep(tenantId, e); // mục cũ hơn có đè mục mới thì lần đọc sau chỉ trượt (so dấu vân tay), không sai
            return e;
          })
          .finally(() => inflight.delete(k));
        inflight.set(k, p);
      }
      return p;
    },
  };
}
