-- CR-125 · x12 · Cài đặt công ty "Kèm ảnh trang đầu trong email mời ký" (mặc định BẬT). Chỉ cộng thêm; chạy lại vô hại.
ALTER TABLE contracts.approval_settings ADD COLUMN IF NOT EXISTS esign_invite_thumbnail boolean NOT NULL DEFAULT true;
