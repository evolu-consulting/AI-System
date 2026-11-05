---
id: cr121-w2-workspace-e2e
lát: cr121-w2-workspace-e2e
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c5..c8, cr121-a1, cr121-d6b
---
## Plan (ngắn)
Lượt verify:wave cuối đợt có e2e workspace-web đỏ MỚI. Chạy lại đúng job trên evotest (4 lượt), phân loại từng ca, sửa code/test, không nới assert.

## Làm
| Ca | Loại | Sửa |
|---|---|---|
| contracts-web scenes nav-v2 ×6 (bell/feedback/popover x lệch 1000 px) | (a) lỗi sản phẩm C-8 | `Header`: khe tìm ẩn ở Sổ Hợp Tác làm mất khoảng đệm `flex-1` ⇒ cụm nút Header dồn sang trái; thêm `ml-auto` cho `topbar-actions`. Baseline GIỮ NGUYÊN (khớp lại, không cập nhật ảnh) |
| community-web sidebar-one #3 (`assistant-fab` có 2) | (a) lỗi sản phẩm C-6 | `Shell` vẽ thêm nút trợ lý ở `/community` trong khi `ChatDock` đã có ⇒ ẩn nút của Shell khi ở Community |
| community-web sidebar-one #2 (`/contracts/approvals` ⇒ `/contracts/c/approvals`) | (a) lỗi sản phẩm C-7 | `CONTRACTS_PAGES` thiếu `approvals` nên `legacyTarget` coi là id HĐ cũ; thêm + unit |
| community-web sidebar-one #1, #2, #3 sang Sổ Hợp Tác ⇒ `/login` | (b) test sai môi trường | bản build mock Community không có phiên; giả `/auth/refresh` + `/pack/contracts/me` (như e2e contracts-web) |
| community-web sidebar-one #1 (2 `aria-current`) | (b) test quá rộng | đếm mục menu `[data-nav-item][aria-current]`; liên kết thương hiệu `/contracts` được router đặt aria-current theo tiền tố |
| contracts-web contract-flow "CR-120 rollback" | (b) test sai thiết kế | CR-121 A-1 gỡ `legacy-act` (một đường duy nhất): đổi thành "cờ tắt ⇒ Đạt vẫn đi route flow, không POST approvals cũ, không GET view" |
| contracts-web cr120-intake-flow "Xác nhận và lưu (engine)" | (b) test sai thiết kế | hành động đi route flow ⇒ dùng `mockApprovalFlow` thay vì POST `/approval` cũ |
| journey cr121-d6b ca 1 | (d) chập chờn | đỏ ở wave (tải 7 slot), xanh ở 3 lượt chạy lại |
| journey refresh-reload.ja ca 2, cr121-editor ×2 | (d) chập chờn | `Protocol error: Not attached to an active page` / `Nhân bản` strict-mode do danh sách chưa tải; xanh ở lượt sau |
| journey cr121-d6b ca 3 (chuông thiếu mã/tên HĐ) | (a) lỗi sản phẩm CÒN MỞ | xem "Việc còn lại" |

## Không làm / Chạm
Không đụng admin-web, hub-api migrations, DLC. Không cập nhật baseline ảnh.

## Test tối thiểu
Unit `legacy-routes.test.ts`, `src/features/shell` xanh. e2e (evotest, 4 lượt): contracts-web 100% xanh; community-web + community-web-stack xanh; journey-approval-journey xanh trừ d6b ca 3.

## Quyết định trong lúc làm
- Baseline nav-v2 không đổi: sai khác chỉ là lỗi căn lề Header (x lệch đúng 1000 px), không phải thay đổi có chủ đích của C-6.
- Không thêm known-red cho d6b ca 3: là lỗi thật của tính năng, không phải đỏ có sẵn (job không có ở base d4985a56).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa 3 chỗ triển khai lệch Delta đã duyệt của C-6/C-7/C-8 — căn lề Header, một nút trợ lý ở Community, route "Chờ tôi duyệt" — và 3 e2e sai thiết kế/môi trường; không đổi yêu cầu)

## Việc còn lại
- d6b ca 3 (hub-api, chủ D-6b): bước Thông báo dùng input run điền lúc MỞ run (`approval-engine.usecase.ts openRun` ⇒ `difyFacts`), lúc đó `contracts.number` còn null và `title` là tên file; sau "Xác nhận và lưu" số/tên HĐ mới có. Kết quả: thông báo "Đã duyệt xong hợp đồng · hop-dong-…" thiếu mã HĐ. Cần điền lại input (số, tên, giá trị) khi người dùng xác nhận hoặc đọc tại thời điểm chạy bước Thông báo.