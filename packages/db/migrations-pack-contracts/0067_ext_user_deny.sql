-- CR-102a · com-c2-ext-deny: RLS phòng thủ — user ngoài (đối tác) thấy 0 hàng và không ghi được hàng nào của gói
-- `contracts`, kể cả khi lớp cổng (tường lửa user ngoài + packGuard của hub-api) bị bỏ sót. `withPackScope` đặt
-- `app.user_kind` từ DB (`admin.users.kind` theo `app.user_id`) cùng câu với `app.user_id` ⇒ gói không đọc schema admin.
-- Việc nền / GUC vắng ⇒ '' ⇒ như cũ. Không subquery, không hàm: chi phí ~0 mỗi hàng.
-- Bảng contracts tạo SAU migration này phải tự thêm policy `ext_deny` (ghi ở tasks.md com-c2-ext-deny).
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'contracts' AND c.relkind IN ('r', 'p') AND c.relrowsecurity LOOP
    EXECUTE format('DROP POLICY IF EXISTS ext_deny ON contracts.%I', r.relname);
    EXECUTE format('CREATE POLICY ext_deny ON contracts.%I AS RESTRICTIVE FOR ALL TO contracts_rw '
                   'USING (coalesce(current_setting(''app.user_kind'', true), '''') <> ''external'') '
                   'WITH CHECK (coalesce(current_setting(''app.user_kind'', true), '''') <> ''external'')',
                   r.relname);
  END LOOP;
END $$;
