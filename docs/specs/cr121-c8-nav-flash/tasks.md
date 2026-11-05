---
id: cr121-c8-nav-flash
lát: cr121-c8-nav-flash
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

## Làm

## Không làm / Chạm

## Test tối thiểu

## Quyết định trong lúc làm

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED community/nghiep-vu.md
#### Yêu cầu: Thanh trái và khe tìm theo đích điều hướng
Ngay lúc bấm một mục menu (trang đích còn tải lười), thanh trái chỉ sáng mục đích và khe tìm của thanh trên đổi theo module đích (Sổ Hợp Tác để trống); mọi chỗ của khung đọc đường dẫn đích từ MỘT nguồn (lịch sử router), không từ route đã commit.
- Kịch bản: khi đang ở /community và bấm "Hợp đồng & giao dịch" thì ngay sau đó chỉ một mục có aria-current và ô tìm Community ẩn [test: e2e/community-web/sidebar-one.cm.ts » Community → Sổ Hợp Tác: cùng một thanh trái (shell-sidebar), mục đang chọn đổi đúng, không có thanh trái thứ hai]
- Kịch bản: khi trang đích chưa commit thì đường dẫn đích của khung là đích, còn location đã commit là cũ [test: apps/workspace-web/src/shell/use-nav-path.test.tsx » khe tìm: chỉ module đích sở hữu]

## Việc còn lại
