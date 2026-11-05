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

Evotest (c832de8b + sửa test): int CF 43 pass / 0 fail (có `confirm-step`, `engine-off-flag`); e2e journey 4 pass / 1 fail.
- Đã làm: bước "Xác nhận" do gói tự thêm ở đầu lượt cho quy trình thư viện không bắt đầu bằng nhóm sửa (`withConfirmStep`, một chỗ, không thêm SQL); cờ `engine_off` trên `GET /contracts/:id/approval` (+1 gọi cổng/tuyến chỉ cho lượt máy cũ) + ghi chú workspace-web. Ca 2 (engine tắt ⇒ UI nêu lý do) nay XANH.
- ĐỎ ca 4: nhân viên xác nhận xong (bước "Phòng Kế toán duyệt" hiện) nhưng trưởng Kế toán mở HĐ KHÔNG thấy thẻ duyệt/bước (HĐ của phòng Kinh doanh — nghi quyền xem theo phòng ban chặn người duyệt khác phòng, cần soát `org-visibility`); chưa kịp chẩn đoán.
- LƯU Ý lệch yêu cầu A: xác nhận vẫn là stage `s0` của run (do gói thêm, không do quy trình khai), chưa tách thành hành động trước khi mở run; run vẫn mở lúc AI đọc xong (không đổi đường mở run).
- Chạy `deployed/21-approval-journey.rw.deployed.ts` qua runner sau khi `seed-e2e-journey.ts` chạy trên máy chủ (cần `E2E_JOURNEY_PW`, `ADMIN_PW`).