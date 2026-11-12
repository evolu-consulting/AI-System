# Bảng tin là tính năng thêm của Sổ Hợp Tác (CR-130 pha 3, ADR-0044)

Nguồn: lát cr130-p3c (gộp 2026-11-12). Phần quyền/dữ liệu phía community: `community/nghiep-vu.md` mục «CR-130».

#### Yêu cầu: Chỉ quản trị nền tảng bật «Bảng tin» (mặc định tắt)
Màn công ty của quản trị nền tảng có công tắc «Bảng tin» trong tính năng thêm của Sổ Hợp Tác (add-on `contracts-community`). Không còn mức Xem/Sửa/Quản trị riêng, vai hay Group Bảng tin; quản trị công ty chỉ xem trạng thái. Khoá `community-read|write|admin` không còn được đăng ký.
- Kịch bản: «Bảng tin» là tính năng thêm đã đăng ký của SHT [test: apps/admin-web/src/features/features/lib/feature-meta.test.ts » metaOf]
- Kịch bản: thẻ app SHT chứa «Bảng tin», mức theo khoá `contracts-*` [test: apps/admin-web/src/features/tenants/lib/feature-assign.test.ts » ADR-0044]

#### Yêu cầu: Mặt Bảng tin dùng mức quyền Sổ Hợp Tác
Xem trước quyền app Bảng tin tính theo `contracts-read/write/admin`; node «Hiện bài» cần tính năng `contracts-community`.
- Kịch bản: bật read + write ⇒ mức Sửa [test: packages/contracts/src/app-manifest/preview.test.ts » previewApp]
- Kịch bản: chưa bật `contracts-community` ⇒ mẫu có node «Hiện bài» chưa sẵn sàng, nêu tính năng và bước [test: packages/contracts/src/modules/template-readiness.test.ts » templateReadiness]
