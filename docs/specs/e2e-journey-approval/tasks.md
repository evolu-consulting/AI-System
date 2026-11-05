---
id: e2e-journey-approval
lát: e2e-journey-approval
cr:
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

Lỗi prod: tenant NiTi có quy trình + luật nhưng feature `contracts-approval-engine` tắt ⇒ HĐ xác nhận không vào duyệt, không có nút duyệt; e2e cũ mock hub hoặc seed tenant đã bật engine. Thêm e2e hành trình KHÔNG mock (chỉ CLI Claude giả) đi đúng đường thật.

## Làm

- `tools/scripts/src/seed-e2e-journey.ts` (+ test): tenant `e2e-approval` dựng bằng `runSeed` của seed-niti (thêm `SeedOpts.routing=false`; helper tách ra `seed-niti.tools.ts`), KHÔNG gán/luật/feature engine. Chỉ chạm khoá `e2e-`.
- `e2e/journey-approval/`: `_ja-stack.ts` + `playwright.journey.config.ts` (job `journey-approval`, META `ja`), `approval.ja.ts` (4 ca nối tiếp), `_journey.ts` (bước UI dùng chung), `_fixture.ts`.
- `e2e/deployed/21-approval-journey.rw.deployed.ts`: cùng hành trình trên tenant `e2e-approval` của máy chủ (chạy tay qua runner, KHÔNG chạy trong lát).

## Không làm / Chạm

Không sửa sản phẩm: ca âm (UI nêu lý do engine tắt) để ĐỎ nếu sản phẩm chưa có — đó là lỗ hổng sản phẩm, không nới test. Không đụng NiTi/Demo.

## Test tối thiểu

Unit `seed-e2e-journey.test.ts`; e2e `approval.ja.ts` chạy MỘT lần trên evotest (`-Filter journey-approval`).

## Quyết định trong lúc làm

- HĐ mẫu là `.md` (đường đọc chữ, không cần bộ chuyển DOCX/PDF); AI = CLI giả (`AI_SUB_CLI_PATH`) trả JSON trích có quote nguyên văn.
- Mật khẩu 4 tài khoản = env `JA_USER_PW` (stack, ngẫu nhiên) / `E2E_JOURNEY_PW` (máy chủ), không buộc đổi lần đầu.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: lát chỉ thêm tool seed tenant `e2e-` và e2e; không sửa mã sản phẩm — lỗ hổng "engine tắt mà UI không nói lý do" chỉ được test bắt, chưa sửa).

## Việc còn lại

- CHẶN ca 2 và 4 (hạ tầng stack, không phải lỗi sản phẩm): upload HĐ cần FileBox (HTTP, `FILEBOX_URL/TOKEN`, `HUB_ATTACH_DRIVER=filebox`); `HUB_ATTACH_DRIVER=local` không đủ (hub trả 503 FILE_STORAGE_UNAVAILABLE). Cần FileBox giả trong `_ja-stack.ts` (khuôn tests/acceptance/FB1) rồi chạy lại job `journey-approval`.
- Kết quả evotest (b6d8a60e): ca 1 (gán 2 quy trình + 2 luật qua ai-admin) và ca 3 (bật switch engine qua ai-admin) XANH; ca 1b ĐỎ = lỗ hổng sản phẩm (ai-admin /apps/contracts không cảnh báo `flowNeedsAddon` dù tenant có quy trình gán + luật mà chưa có engine; chỉ hiện cảnh báo thiếu địa chỉ app).
- Lỗi nhỏ thấy được: ô 'Đang dùng (mặc định của khe)' hiện nguyên `{{name}}` (nội suy i18n hỏng) ở khối quy trình gán của ai-admin.

- Sửa sản phẩm theo ca 2 của `approval.ja.ts` nếu đỏ (hiện lý do khi tenant có quy trình gán/luật nhưng chưa có feature engine).
- Chạy `deployed/21-approval-journey.rw.deployed.ts` qua runner sau khi `seed-e2e-journey.ts` chạy trên máy chủ (cần `E2E_JOURNEY_PW`, `ADMIN_PW`).
