---
id: fnr-fix-e2e
lát: fnr-fix-e2e
cr: CR-103
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
E2E showcase tự đủ dữ liệu: flow mẫu + 3 Group duyệt + Adm (binh) làm thành viên được seed vào tenant acme của stack e2e, rồi chạy thật hai kịch bản.

## Làm
- [x] `e2e/fnr-showcase/_seed.ts`: Group `fnr-*` (id cố định), membership Adm, def mẫu dựng bằng `buildShowcaseDef` + kiểm/ép bằng `checkShowcase` (như API lưu), idempotent. `e2e/P-a/_pa-stack.ts` gọi khi env `FNR_SHOWCASE_SEED=1` (config fnr đặt) — trước khi Hub lên, project e2e khác không thấy.
- [x] `showcase.fnr.ts`: vào admin-web bằng `ADMIN_URL` (baseURL của config là chat-web); khẳng định nhánh else bằng huy hiệu run + "Giám đốc duyệt" không chạy.
- [x] Sửa trang: `ShowcaseReview` (Đạt/Từ chối cho `run.my_tasks` review mở, `useReviewDecision` → `POST /review-tasks/:id/decision`) — `RunActions` chỉ lo "Cần người quyết"/Huỷ nên trước đây không có nút duyệt.
- [x] Sửa lỗi engine: `nodes/set/launch.ts` không còn đặt `more:false` đè `more` của hàng đợi bước (stage song song thứ hai kẹt `queued`).

## Không làm / Chạm
Không đổi contract, không chạy seed thật.

## Test tối thiểu
Playwright `e2e/fnr-showcase/playwright.fnr.config.ts`: 2/2 xanh (chạy bằng `bun tools/scripts/src/run-playwright.ts` với `PA_E2E_ENV=.env.test-fnrsc.local PA_REDIS_DB=15`, tránh tranh chấp Redis với `test:e2e:par`).

## Quyết định trong lúc làm
- Seed trong `_pa-stack.ts` (trước Hub) thay vì beforeAll: Hub nạp Group/membership lúc khởi động, seed sau sẽ không thấy.
- Nút duyệt "Từ chối" gửi feedback cố định (reject bắt buộc feedback).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: e2e showcase tự seed)