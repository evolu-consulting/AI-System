// tool-affected-modules · kiểu Scope/Reasons tách riêng để test-affected.closure không import ngược test-affected.scope (vòng import).
export type Reasons = Map<string, string>;
export type Scope = {
  /** Seed bao đóng ngược ĐẦY ĐỦ. */
  broad: Reasons;
  /** Seed bao đóng ngược CẮT ở file lắp ráp (app.ts/*.mount.ts): module khác boot cả app không bị kéo theo. */
  module: Reasons;
  /** Int luôn chạy khi migration đổi (migrate/RLS meta). */
  extraInt: Reasons;
  /** Cấu hình e2e thêm (theo gói). */
  extraE2e: Reasons;
  unitAll: boolean;
  typecheckAll: boolean;
  /** --strict: hành vi cũ (rộng). */
  strict: boolean;
  /** Có migration phải chọn rộng (đổi đối tượng sẵn có / không phân loại được). */
  migrationBroad: boolean;
  notes: string[];
  /** `--explain`: lý do MỖI chỗ mở rộng danh sách (file gốc/schema/barrel thật sự ảnh hưởng runtime). */
  expand: string[];
  /** File đổi nhưng "không ảnh hưởng test runtime" (bỏ qua khi chọn test). */
  ignored: string[];
};
