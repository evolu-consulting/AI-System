-- CR-122 · bước Ký số của flow khoá HĐ (`locked_at`) TRƯỚC khi xác nhận ("Kết thúc · Đã duyệt" sau khi ký xong).
-- Trigger thay bản cũ (0049) trước đây chạy khi `locked_at` từ null ⇒ có giá trị (khoá = xác nhận). Nay khoá có thể đến sớm, nên chỉ
-- thay bản cũ khi HĐ VÀO trạng thái đã xác nhận mà đã khoá: (khoá mới) hoặc (trạng thái mới chuyển sang đã xác nhận).
-- Đường cũ (xác nhận + khoá cùng câu) giữ nguyên hành vi; mở lại xoá cả hai nên xác nhận lại vẫn chạy như trước.
DROP TRIGGER IF EXISTS contracts_k2_supersede ON contracts.contracts;
--> statement-breakpoint
CREATE TRIGGER contracts_k2_supersede AFTER UPDATE ON contracts.contracts
  FOR EACH ROW WHEN (NEW.supersedes_id IS NOT NULL AND NEW.superseded_at IS NULL
    AND NEW.locked_at IS NOT NULL
    AND NEW.status IN ('active', 'expiring', 'expired', 'renewed', 'terminated')
    AND (OLD.locked_at IS NULL OR OLD.status NOT IN ('active', 'expiring', 'expired', 'renewed', 'terminated')))
  EXECUTE FUNCTION contracts.k2_supersede();
