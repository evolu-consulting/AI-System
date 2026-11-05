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

Không thay đổi hành vi (lý do: lát thêm tool seed tenant `e2e-`, e2e và int; quyền xem của người duyệt đã có từ CR-109 `contracts.reviewer_contract_ids` — int `CF/approver-visible-run` chỉ khoá lại, không sửa mã sản phẩm).

## Việc còn lại

Evotest (c832de8b + sửa test): int CF 43 pass / 0 fail (có `confirm-step`, `engine-off-flag`); e2e journey 4 pass / 1 fail.
- Đã làm: bước "Xác nhận" do gói tự thêm ở đầu lượt cho quy trình thư viện không bắt đầu bằng nhóm sửa (`withConfirmStep`, một chỗ, không thêm SQL); cờ `engine_off` trên `GET /contracts/:id/approval` (+1 gọi cổng/tuyến chỉ cho lượt máy cũ) + ghi chú workspace-web. Ca 2 (engine tắt ⇒ UI nêu lý do) nay XANH.
- Ca 4 XANH (e2e journey 5/5): KHÔNG phải lỗi quyền xem. RLS `contracts_visible` (0070, `reviewer_contract_ids`) đã cho trưởng phòng của bước đang mở đọc HĐ + thẻ duyệt dù ngoài cây chủ HĐ; int `CF/approver-visible-run` (head_only, mode org) chứng minh: trưởng Kế toán đọc + `can_act` sau Xác nhận; thành viên Kế toán thường, tenant khác, Giám đốc-trước-bước 403/404; Giám đốc đọc khi run tới bước. Nguyên nhân thật: test `approveAs` gọi `reload()` giữa lượt `POST /auth/refresh` của SPA ⇒ phản hồi Set-Cookie bị huỷ, token bị coi đã xoay ⇒ 401 ⇒ về trang đăng nhập; sửa: chờ thẻ duyệt tải xong trước khi tải lại.
- LƯU Ý lệch yêu cầu A: xác nhận vẫn là stage `s0` của run (do gói thêm, không do quy trình khai), chưa tách thành hành động trước khi mở run; run vẫn mở lúc AI đọc xong (không đổi đường mở run).
- Chạy `deployed/21-approval-journey.rw.deployed.ts` qua runner sau khi `seed-e2e-journey.ts` chạy trên máy chủ (cần `E2E_JOURNEY_PW`, `ADMIN_PW`).