---
id: pl-sample-filter
lát: pl-sample-filter
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: L2a (kind), L3 (tab)
---
## Plan (ngắn)
Lọc mẫu hẳn khỏi danh sách chính (người dùng yêu cầu, CR-105). Hub `GET /process-defs`: thêm `kind=sample` = "Mẫu · chạy thử" = mẫu toàn nền tảng (tenant NULL, khe NULL) + def tenant KHÔNG khe, KHÔNG của gói (`pack_version` NULL, `source_ref` NULL) — vd `flow-showcase`, bản "Chép mẫu"; danh sách mặc định (không `kind`) = def thư viện (có khe) + def của gói (`pack_version` không NULL), def vật chất hoá (`source_ref`) vẫn ẩn. admin-web: tab "Mẫu · chạy thử" dùng `kind=sample` cho mọi vai; hàng mẫu toàn nền tảng chỉ "Chép mẫu" (trừ platform_admin).

## Quyết định trong lúc làm
- `pack_key` không có trên `process_defs` (chỉ trên `process_runs`); def của gói đánh dấu bằng `pack_version` (`PackRunsPort.ensureDef`) ⇒ dùng `pack_version IS NOT NULL`.
- e2e P-a/P-b/P-b2/fnr tra def theo key trong danh sách mặc định ⇒ đổi sang `kind=sample` (không chạy trong lát); UI e2e mở def tenant ở tab chính cần mở tab "Mẫu · chạy thử" (cuối đợt).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: sửa theo CR-105 lọc mẫu)
