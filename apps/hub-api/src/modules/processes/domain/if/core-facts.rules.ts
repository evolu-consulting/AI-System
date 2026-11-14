// CR-160 · dữ kiện LÕI của lượt (không thuộc app nào): engine tự đọc từ chính lượt + sơ đồ tổ chức, nên có ở MỌI lượt kể cả lượt bắt đầu bằng phiếu
// (không có bản ghi app ⇒ không có `FactsReader`). App chỉ KHAI khoá ở manifest `events[].facts` để trình sửa cho chọn và lưu def kiểm kiểu.
// Luật thuần (bản SQL ở `adapters/runs/core-facts.repo.ts`): `starter_is_top` Đúng ⇔ người bắt đầu lượt đang là trưởng của một phòng GỐC.

/** Khoá dữ kiện lõi (khớp `AppFactDecl.key` ở manifest). */
export const CORE_FACT_KEYS = ["starter_is_top"] as const;
export type CoreFactKey = (typeof CORE_FACT_KEYS)[number];

const isCore = (k: string): k is CoreFactKey => (CORE_FACT_KEYS as readonly string[]).includes(k);

/** Tách khoá được hỏi: `core` do engine đọc, `app` giao `FactsReader` của app (khoá lạ đi về app, như trước). */
export function splitFactKeys(keys: readonly string[]): { core: CoreFactKey[]; app: string[] } {
  return { core: keys.filter(isCore), app: keys.filter((k) => !isCore(k)) };
}

/**
 * «Người gửi là cấp cao nhất»: người bắt đầu lượt là `head_user_id` của một phòng không có phòng cha.
 * Không có người bắt đầu (hệ thống) hoặc phòng gốc chưa có trưởng ⇒ Sai. Không xét trưởng còn dùng được hay bị khoá: câu hỏi là "ai đang
 * đứng đầu sơ đồ", người bị khoá không gửi được nên không tới đây.
 */
export function starterIsTop(
  starterId: string | null,
  rootHeadIds: readonly (string | null)[],
): boolean {
  return starterId !== null && rootHeadIds.some((h) => h === starterId);
}

/** Gộp dữ kiện lõi vào dữ kiện app (lõi thắng khi trùng khoá); cả hai trống ⇒ null (≡ chưa có dữ liệu). */
export function mergeFacts<V>(
  app: Readonly<Record<string, V>> | null,
  core: Readonly<Record<string, V>> | null,
): Record<string, V> | null {
  if (!app && !core) return null;
  return { ...(app ?? {}), ...(core ?? {}) };
}
