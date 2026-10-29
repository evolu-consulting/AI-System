---
id: fix-chat-e2e-login
lát: fix-chat-e2e-login
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Nguyên nhân: portal-home (da1c4d80, migration 0018) cho đăng nhập hạ cánh ở trang chủ `/` (màn chọn ứng dụng) khi công ty chưa đặt app mặc định. Đây là hành vi chủ ý; `chatLogin` của e2e vẫn chờ `/c/new`.

## Làm
- `e2e/chat/_x2a-support.ts` và `e2e/combine/_support.ts` (`chatLogin`): chờ rời `/login`, nếu chưa ở `/c/new` thì `goto("/c/new")` (giống `e2e/chat/_support.ts`). P-a/P-b/P-c/K1 dùng lại helper này.
- relock `tests/.lock`.

## Không làm / Chạm
Không đổi sản phẩm; không đặt app mặc định trong seed (giữ đúng mặc định hiện hành).

## Test tối thiểu
e2e theo cấu hình; xem báo cáo trước/sau.

## Quyết định trong lúc làm
Sửa tập trung ở helper đăng nhập thay vì seed `default_app` để màn chọn ứng dụng vẫn được phủ.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: e2e theo màn chọn ứng dụng sau đăng nhập)

## Việc còn lại
Lỗi không do đăng nhập (UI lệch): P-b editor E-PB08/09, P-b2 canvas E-PB2-08, P-a E-P6/E-P15b, P-c2 decision/result, P-d admin-stage/chat-labels/uat-fixes, chat i18n/theme/x1 English (hộp Cài đặt), x2a-dm AC-45 và x2a-group AC-43, x2b2 attach (chập chờn).
