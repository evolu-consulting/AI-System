---
id: cr180-mobile-base
lát: cr180-mobile-base
cr: CR-180
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Nền mobile dùng chung cho 8 luật CR-180: cỡ chạm 44px trong kit, chữ ≥ 12px ở thanh dưới, 3 component mới (PageHeader, FilterBar, MetaList), lớp `tap-target`, luật nút nổi + lề trong RULES.

## Làm
- [x] Kit: Button/Tabs/ToggleGroup/Select/Input/menu `max-sm:min-h-11`; `--control-sm` điện thoại 44.
- [x] BottomNav nhãn 12px, badge số 11px (ngoại lệ ghi RULES).
- [x] `page-header.tsx`, `filter-bar.tsx`, `meta-list.tsx`, `.tap-target`.
- [x] NotificationsPage prop `embedded` (hết thụt 2 lớp lề + `<main>` lồng); route workspace dùng.
- [x] RULES mục «Mobile (≤ 640px)», README.

## Không làm / Chạm
Không chuyển trang sang component mới (lát 2). Chạm: web-kit ui/kit, tokens.css, NotificationsPage, BottomNav, route notifications.

## Test tối thiểu
`apps/workspace-web/src/components/shared/mobile-kit.test.tsx`.

## Quyết định trong lúc làm
- Test render tĩnh đặt ở workspace-web (web-kit không có react-dom).
- Nút phụ PageHeader render 2 dạng (nút desktop + «⋯» điện thoại) ẩn bằng CSS; nút chính chỉ 1 lần.
- Luật 6: `main` của Shell đã có `--fab-safe` cho mọi trang (Thông báo, Cài đặt đều nằm trong main, không có cuộn riêng) ⇒ chỉ thêm luật.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-16 (đợt cr177-180)

### ADDED web/mobile.md
#### Yêu cầu: Vùng bấm ≥ 44px trên điện thoại
Trên màn ≤ 640px mọi nút, tab, mục nhóm chuyển, ô chọn, ô nhập và mục menu có vùng bấm cao ≥ 44px; desktop giữ nguyên.
- Kịch bản: khi render Button/Input/Tabs/ToggleGroup/Select thì có lớp `max-sm:min-h-11` [test: apps/workspace-web/src/components/shared/mobile-kit.test.tsx » cỡ chạm ≥ 44px trên điện thoại]
- Kịch bản: khi mở 18 màn ở 390px thì không còn vùng bấm < 44px [test: thủ công — e2e kiểm mobile ở lát cr180-mobile-audit]

#### Yêu cầu: Chữ tối thiểu 12px
Thanh điều hướng dưới dùng chữ 12px; chỉ số trong badge tròn nhỏ được 11px.
- Kịch bản: khi mở thanh dưới ở 360px thì 5 mục không vỡ, nhãn dài cắt «…» [test: thủ công — e2e kiểm mobile ở lát cr180-mobile-audit]

#### Yêu cầu: Đầu trang dùng chung
Điện thoại: tiêu đề một hàng, nút chính rộng hết bên dưới, nút phụ trong menu «⋯». Desktop: nút phụ + nút chính bên phải tiêu đề.
- Kịch bản: khi có nút phụ thì điện thoại hiện «⋯», desktop hiện nút [test: apps/workspace-web/src/components/shared/mobile-kit.test.tsx » PageHeader]

#### Yêu cầu: Khung bộ lọc dùng chung
Điện thoại: chip một hàng cuộn ngang, bộ lọc nâng cao trong nút «Lọc» mở từ dưới lên. Desktop như cũ.
- Kịch bản: khi có bộ lọc nâng cao thì điện thoại ẩn chúng và hiện nút «Lọc» [test: apps/workspace-web/src/components/shared/mobile-kit.test.tsx » FilterBar]

#### Yêu cầu: Dòng «nhãn: giá trị»
Desktop một hàng «A · B · C» không dấu «·» đầu/cuối; điện thoại mỗi mục một dòng.
- Kịch bản: khi có mục rỗng thì bị bỏ và dấu «·» chỉ giữa các mục [test: apps/workspace-web/src/components/shared/mobile-kit.test.tsx » MetaList]

#### Yêu cầu: Nút nổi và lề trang
Mọi vùng cuộn chính chừa đáy `--fab-safe`; lề ngang điện thoại 16px do shell cấp, trang con không lồng lề.
- Kịch bản: khi mở trang Thông báo ở điện thoại thì lề trái 16px, không thụt thêm [test: thủ công — e2e kiểm mobile ở lát cr180-mobile-audit]

## Việc còn lại
Lát 2: chuyển các trang sang PageHeader/FilterBar/MetaList.
