// W1 · "Mua hàng": bộ nhớ đệm dòng giá THEO TENANT, trong tiến trình (LRU nhỏ), khoá bằng "dấu vân tay" dữ liệu (số HĐ đã duyệt + `updated_at` lớn
// nhất + tổng `version` + số/ngày lựa chọn nguồn) và ngày lịch. Dòng giá (khoá sản phẩm, thay giá phụ lục) là phần đắt và KHÔNG phụ thuộc
// người xem; luật thấy (M1) áp mỗi request bằng tập id HĐ người đó thấy. Nhiều request cùng lúc khi trượt dùng chung MỘT lần nạp.
import type { PriceLine, RawChoice } from "../domain/sourcing.rules";

export type SourcingEntry = {
  fp: string;
  today: string;
  lines: PriceLine[];
  choices: RawChoice[];
  truncated: boolean;
};

export type SourcingCache = {
  get(tenantId: string): SourcingEntry | undefined;
  fill(tenantId: string, load: () => Promise<SourcingEntry>): Promise<SourcingEntry>;
};

export function createSourcingCache(max = 16): SourcingCache {
  const store = new Map<string, SourcingEntry>();
  const inflight = new Map<string, Promise<SourcingEntry>>();
  return {
    get(tenantId) {
      const e = store.get(tenantId);
      if (e) {
        store.delete(tenantId); // LRU: đưa lên cuối
        store.set(tenantId, e);
      }
      return e;
    },
    fill(tenantId, load) {
      let p = inflight.get(tenantId);
      if (!p) {
        p = load()
          .then((e) => {
            store.delete(tenantId);
            store.set(tenantId, e);
            if (store.size > max) store.delete(store.keys().next().value as string);
            return e;
          })
          .finally(() => inflight.delete(tenantId));
        inflight.set(tenantId, p);
      }
      return p;
    },
  };
}
