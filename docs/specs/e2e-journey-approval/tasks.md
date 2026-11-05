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

Kết quả evotest d6793c16 (rebase trên gd0 b1b1d3ab): ca 1 (gán 2 quy trình + 2 luật), 1b (khối Quy trình nêu "Đang tắt … không chạy"), 3 (bật công tắc "Duyệt theo quy trình") XANH. Đã làm trong lát (UI): ghi chú `tenant-engine-off-note` ở khối Quy trình ai-admin, sửa `{{name}}` → `{name}` (i18n), `EngineOffNote` ở thẻ duyệt workspace-web, FileBox giả trong stack.
- ĐỎ ca 4 (lỗ hổng/lệch thiết kế): engine bật, quy trình Mua = Kế toán → Giám đốc ⇒ nhân viên KD tải HĐ KHÔNG có nút "Xác nhận và lưu" ("Bước này chỉ trưởng phòng duyệt được"): bước 0 của quy trình thư viện chính là bước xác nhận và thuộc trưởng phòng Kế toán. Cần chốt: người tải xác nhận trước (thêm bước soạn) hay trưởng Kế toán vừa xác nhận vừa duyệt; hiện hành trình "nhân viên xác nhận → KT duyệt → BGĐ duyệt" không đi được.
- ĐỎ ca 2: engine tắt, nhân viên xác nhận xong thì HĐ thành "Xác nhận xong" (máy cũ) và trang không còn thẻ duyệt ⇒ `EngineOffNote` (chỉ hiện khi còn thẻ duyệt) không hiện; cần hub trả cờ "công ty có quy trình gán nhưng engine tắt" trên chi tiết HĐ hoặc ghi vào dòng thời gian.
- Chạy `deployed/21-approval-journey.rw.deployed.ts` qua runner sau khi `seed-e2e-journey.ts` chạy trên máy chủ (cần `E2E_JOURNEY_PW`, `ADMIN_PW`).