-- CR-102a · com-fix-pool-scope: pool riêng `knowledge_api` (R1) mở tx gói bằng `withPackScope`, câu đầu gọi 2 hàm DEFINER của bộ
-- khung (`packs.scope_user_kind`, `packs.scope_ext_org`) ⇒ cấp đúng EXECUTE 2 hàm đó (+ USAGE schema `packs`). Không cấp gì
-- trên `admin`/`hub`/`contracts`; bảng gói vẫn chỉ qua SET ROLE `knowledge_rw`.
GRANT USAGE ON SCHEMA packs TO knowledge_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION packs.scope_user_kind(text) TO knowledge_api;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION packs.scope_ext_org(text, text) TO knowledge_api;
