---
id: cr121-f13-flows-simple
lát: cr121-f13-flows-simple
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c
---
## Plan (ngắn)
Bảng Công ty › Quy trình còn nhiều chữ, trái "design đơn giản" của người dùng: bỏ câu dài đầu bảng, thông báo app chưa dùng một lần ở hàng nhóm, nhãn mặc định hệ thống ngắn.

## Làm
- Bỏ câu giới thiệu dài đầu bảng; nội dung chuyển vào ⓘ cạnh tiêu đề cột "Quy trình" (tooltip).
- App chưa dùng: thông báo MỘT lần ở hàng nhóm app ("Sổ Hợp Tác · 2 việc · Chưa dùng ứng dụng — Bật ở tab Ứng dụng", một dòng, link); các hàng việc chỉ còn viên "Chưa dùng ứng dụng" và mờ đi (không lặp lý do, không xuống hàng).
- "Đang dùng mặc định hệ thống (công ty chưa gán quy trình riêng)" thành viên ngắn "Mặc định" cạnh tên quy trình, câu đầy đủ ở tooltip.
- Tên quy trình (vd "(mẫu CR-113)") là dữ liệu seed, không phải UI tự ghép ⇒ không sửa. Cột Luật "—" giữ khi chưa có luật.

## Đã soát (ảnh 1440px, DPR 2: `…\scratchpad\uat-cr121c\f13\shots\quy-trinh-bang.png`)
- Lượng chữ: bỏ 3 dòng chữ dài (câu đầu bảng, lý do lặp 5 lần, nhãn mặc định lặp 4 lần); mỗi hàng việc 1 dòng (hàng có chip bước 2 dòng); hàng nhóm một dòng.
- Căn mép: Việc · Quy trình · Trạng thái · Luật cùng mép trái với ô (đo `left` tiêu đề = ô); viên trạng thái thẳng mép tiêu đề "Trạng thái"; chip bước và viên "Mặc định" thẳng/liền tên quy trình; ghi chú app chưa dùng thẳng mép tên app.

## Không làm / Chạm
Không sửa e2e. Không đổi dữ liệu seed.

## Test tối thiểu
- unit: bộ unit admin-web hiện có (858 pass); thay đổi là giao diện, kiểm bằng ảnh.

## Ca e2e cần đổi (qc, không chạy)
- Ca đọc `flows-app-off-*`/"Công ty chưa dùng …" ở hàng việc (nay chỉ ở hàng nhóm: `flows-app-off-note`), ca đọc "Đang dùng mặc định hệ thống (…)" ở hàng (nay viên "Mặc định", câu đầy đủ ở `title`), ca đọc câu "Mỗi việc dùng một quy trình lấy từ Thư viện" (nay ở tooltip ⓘ `flows-lead-info`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED admin/cong-ty-quy-trinh-gon.md
#### Yêu cầu: Bảng Quy trình của công ty ít chữ
Ứng dụng công ty chưa dùng chỉ được báo một lần ở hàng nhóm kèm link bật; hàng việc chỉ có viên trạng thái; quy trình dùng mặc định hệ thống chỉ có viên "Mặc định" (giải thích ở tooltip); câu giới thiệu nằm trong ⓘ.
- Kịch bản: giao diện (soát ảnh UAT f13) [test: thủ công — soát ảnh UAT f13 tab Quy trình ở 1440px]

## Việc còn lại
- e2e (qc) theo danh sách trên.
