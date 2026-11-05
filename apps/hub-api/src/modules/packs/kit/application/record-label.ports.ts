// CR-121 Q-1 · cổng "bộ đặt nhãn bản ghi" của gói (lớp 2, chỉ kiểu + registry thuần): Hub không đọc bảng của gói, nên gói đăng ký
// hàm trả nhãn nghiệp vụ (mã HĐ…) cho một TẬP id bản ghi; Hub (trang chi tiết lượt chạy…) hỏi MỘT lần mỗi trang. Không có nhãn ⇒ Hub
// giữ cách đặt nhãn cũ ("HĐ <id8>").
export type RecordLabelSource = {
  /** Khoá gói (= `pack_key` của lượt chạy). */
  pack: string;
  /** Nhãn theo tập: MỘT câu SQL `= any($ids)` trong tx của gói (RLS của `tenantId`); id không thấy ⇒ vắng trong map. */
  labels(tenantId: string, ids: readonly string[]): Promise<Map<string, string>>;
};

export type RecordLabelRegistry = {
  /** Đăng ký lại cùng khoá gói ⇒ thay (mount nhiều app trong một process). */
  register(src: RecordLabelSource): void;
  /** Gói chưa đăng ký / lỗi đọc / `ids` rỗng ⇒ map rỗng (fail-soft: nhãn chỉ là hiển thị). */
  labelsOf(pack: string, tenantId: string, ids: readonly string[]): Promise<Map<string, string>>;
};

export function createRecordLabelRegistry(): RecordLabelRegistry {
  const m = new Map<string, RecordLabelSource>();
  return {
    register: (src) => void m.set(src.pack, src),
    async labelsOf(pack, tenantId, ids) {
      const src = m.get(pack);
      if (!src || ids.length === 0) return new Map();
      try {
        return await src.labels(tenantId, [...new Set(ids)]);
      } catch {
        return new Map();
      }
    },
  };
}
