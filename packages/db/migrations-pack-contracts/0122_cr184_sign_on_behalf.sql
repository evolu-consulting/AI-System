-- CR-184 · ý (5) · «B ký/duyệt thay A (uỷ quyền)» trên bản ký: người ký THẬT vẫn là `signed_by` (chữ ký của B), `on_behalf_of` = A.
-- CHỈ THÊM, chạy lại được. Không FK (A có thể bị khoá/xoá sau này; hồ sơ giữ id).
ALTER TABLE contracts.sign_versions ADD COLUMN IF NOT EXISTS on_behalf_of uuid;
