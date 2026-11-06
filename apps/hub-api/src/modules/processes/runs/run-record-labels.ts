// CR-121 c11b · nhãn nghiệp vụ của bản ghi gắn lượt (mã HĐ thật…) cho danh sách `GET /process-runs`. Một nguồn: `recordLabelRegistry`
// (gói đăng ký `labels(tenantId, ids)` — contracts dùng contractCodeSql/contractLabelSql). THEO TẬP: gom id theo gói của trang, mỗi gói
// MỘT lần hỏi (số câu SQL = số gói khác nhau trong trang, thường 1 — không phụ thuộc số lượt). Lượt không gắn bản ghi / gói chưa
// đăng ký / lỗi đọc ⇒ không có nhãn (fail-soft, `record_label: null`).
import { recordLabelRegistry } from "../../packs/kit/public";

type Rec = { pack_key: string | null; pack_record_id: string | null };
const keyOf = (pack: string, id: string) => `${pack}:${id}`;

export async function runRecordLabels(
  tenantId: string,
  rows: readonly Rec[],
): Promise<Map<string, string>> {
  const byPack = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.pack_key || !r.pack_record_id) continue;
    const s = byPack.get(r.pack_key) ?? new Set<string>();
    s.add(r.pack_record_id);
    byPack.set(r.pack_key, s);
  }
  const out = new Map<string, string>();
  await Promise.all(
    [...byPack].map(async ([pack, ids]) => {
      for (const [id, label] of await recordLabelRegistry.labelsOf(pack, tenantId, [...ids]))
        out.set(keyOf(pack, id), label);
    }),
  );
  return out;
}

export const labelOf = (labels: ReadonlyMap<string, string>, r: Rec): string | null =>
  r.pack_key && r.pack_record_id ? (labels.get(keyOf(r.pack_key, r.pack_record_id)) ?? null) : null;
