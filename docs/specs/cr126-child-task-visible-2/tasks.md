---
id: cr126-child-task-visible-2
lát: cr126-child-task-visible-2
cr: CR-126
làn: nhanh
migration: không
phụ thuộc: cr126-child-task-visible
---
## Plan (ngắn)
e2e `cr125-purchase-full` test 2 vẫn đỏ sau lát 1. Trace Playwright (job journey-approval-journey-purchase, evotest 20261109-030726): `GET /me/review-tasks`
trả 200 với việc 3accb90e của lượt con, `can_act: true` (nhóm, tenant, cache đều đúng). Lỗi ở màn: «Việc chờ tôi» hiện
`requests-waiting-empty` («Chưa có yêu cầu nào chờ bạn duyệt») cả khi danh sách ĐANG TẢI hoặc LỖI ⇒ e2e đếm 0 dòng ngay (và người dùng thấy sai).

## Làm
- `features/requests/lib/waiting.ts` `waitingView`: loading / error / empty / list (`open && can_act`); `RequestsPage` dùng nó: khung chờ khi tải,
  `requests-waiting-error` khi lỗi, «chưa có việc» chỉ khi tải xong và rỗng.
- e2e `actOnWaiting`: chờ `[data-run]` (cây bước tải sau khung trang) trước khi xem form / nút Duyệt.

## Không làm / Chạm
Không đổi hub. Không chạy e2e.

## Test tối thiểu
`apps/workspace-web/src/features/requests/lib/waiting.test.ts` (4 pass).

## Quyết định trong lúc làm
- Lỗi tải dùng lại nhãn `contracts.requests.loadError` (không thêm khoá i18n).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

Không thay đổi hành vi (lý do: sửa lỗi hiển thị trạng thái tải/lỗi của danh sách «Việc chờ tôi»; dữ liệu và luật lọc giữ nguyên).

## Việc còn lại
- Chạy lại `e2e/journey-approval/cr125-purchase-full.spec.ts` ở lượt e2e cuối đợt.
