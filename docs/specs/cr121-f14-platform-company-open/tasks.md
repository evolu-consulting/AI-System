---
id: cr121-f14-platform-company-open
lát: cr121-f14-platform-company-open
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: c17, c17b, F3, F13
---
## Plan (ngắn)
UAT lượt 2: L6 platform_admin mở bản riêng công ty `/processes/<id>` ra "Không tìm thấy"; L7 mở trang lượt chạy `/processes/<def>/runs/<run>` cũng vậy. Nên sửa: chip bước bị cắt giữa chữ, cột "Dùng bởi" lặp chữ, nút Sơ đồ/Danh sách chỉ icon.

## Nguyên nhân (đọc mã Hub + web)
Hub đọc def/lượt của một công ty theo `?tenant_id=`: `defScopeOf` (platform_admin vắng `tenant_id` = phạm vi MẪU ⇒ def của công ty bị ẩn ⇒ 404) và `strictTenantId` của `GET /process-runs/:id/detail`. Trình sửa (`useProcessTenant().tenantId`) và trang lượt chạy chỉ biết công ty khi platform đã "chọn" công ty trong phiên — mở thẳng từ Công ty › Quy trình thì không có ⇒ không gửi `tenant_id` ⇒ 404. tenant_admin không bị vì Hub suy công ty từ phiên.

## Làm — chọn MỘT nguồn: đường dẫn mang công ty (`?company=<id>`), KHÔNG đổi Hub
Lý do: Hub chủ đích buộc platform nêu công ty (RLS/phạm vi tường minh; suy công ty từ id def/lượt ở Hub sẽ nới phạm vi đọc của platform và cần soát bảo mật); lối vào đều biết công ty đang xem.
- `lib/company-copy.ts`: `companySearch(id)` (tham số link), `scopedTenantId(isPlatform, picked, company)`.
- `ProcessEditorPage`: nhận `company`, công ty dùng để đọc/lưu/xem refs/lượt chạy = `?company=` khi platform (hook `useLoadedDef`).
- Mọi link mang công ty: ngăn Công ty › Quy trình ("Mở trình sửa", "Mở trang chi tiết"), "Đang chạy" (F3), sau khi Sao chép + "Mở bản riêng", tab Lượt chạy (cột mã lượt, `runColumns(t, company)`), trang lượt chạy (mở lượt làm lại, lượt liên quan: lấy công ty từ chính `run.tenant.id`). tenant_admin: tham số bị bỏ qua (Hub suy từ phiên).
- Thư viện: `splitChips` thêm ngân sách ký tự (44) — chip gộp vào "+N" nguyên chip, bỏ `truncate`/`max-w` (không cắt giữa chữ). Cột "Dùng bởi": "N công ty" · "—" khi chưa ai dùng · viên `DefaultPill` "Mặc định" (một component, bỏ khỏi cột tên ở Thư viện để không lặp).
- `ViewModeToggle`: thêm nhãn chữ cạnh icon (một component, mọi nơi giống nhau).

## Test
unit: `lib/company-copy.test.ts » CR-121 f14 …`, `lib/step-chips.test.ts » ngân sách ký tự`. Hub không đổi ⇒ không cần int, không cần soát Opus. Perf: không chạm.

## Đã soát
CHƯA chụp/soát ảnh bằng mắt: môi trường agent không có biến môi trường của stack UAT (DATABASE_URL, SEED_ADMIN_PASSWORD…) nên không dựng được stack cổng 346x trong thời hạn. Cần điều phối chụp lại 05a (Thư viện: chip, Dùng bởi), 07a (bản riêng, nút Sơ đồ/Danh sách), L6/L7 bằng platform_admin.

## e2e cần đổi (qc giữ)
Thêm ca platform_admin: Công ty › Quy trình ⇒ "Mở trình sửa" (bản riêng) và bấm lượt ở "Đang chạy" mở được (URL có `?company=`). Cột "Dùng bởi" không còn chữ "Chưa công ty nào dùng"/"Mặc định cho công ty chưa chọn" (nay "—"/viên Mặc định).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/platform-mo-ban-rieng-cong-ty.md
#### Yêu cầu: platform_admin mở được bản riêng và lượt chạy của công ty từ mọi lối vào (CR-121 R3/R8)
Mọi link từ Công ty › Quy trình tới trình sửa bản riêng và trang lượt chạy mang theo công ty đang xem; platform_admin mở được, tenant_admin không cần tham số. Cột "Dùng bởi" ngắn gọn ("—" hoặc viên Mặc định), chip bước không bị cắt giữa chữ, công tắc Sơ đồ/Danh sách có nhãn chữ.
- Kịch bản: link mang công ty; platform đọc theo ?company= còn tenant_admin giữ nguyên [test: apps/admin-web/src/features/processes/lib/company-copy.test.ts » CR-121 f14 · platform mở bản riêng/lượt chạy của công ty]
- Kịch bản: chip gộp nguyên chip vào +N theo ngân sách ký tự [test: apps/admin-web/src/features/processes/lib/step-chips.test.ts » splitChips · ngân sách ký tự (không cắt giữa chữ)]