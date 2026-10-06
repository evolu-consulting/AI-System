# Câu chữ Test panel (Admin) · X1-combine

Phụ lục của `plan-frontend.md` §2.2 (F4). Key i18n: `packages/i18n/locales/{vi,en}.json`, nhóm `commands.test.error.*`. Mã lỗi: `COMMAND_TEST_ERRORS` (`plan.md` §2.2); VI lấy từ `plan.md` §8 BL3, EN bổ sung. Điều phối chốt 2026-10-07 (readiness lần 1).

| Mã (HTTP) | VI | EN |
|---|---|---|
| `HUB_UNAVAILABLE` (502) | Hub không phản hồi. Kiểm tra hub-api rồi thử lại. | Hub is not responding. Check hub-api and try again. |
| `HUB_NOT_CONFIGURED` (503) | Chưa cấu hình kết nối Hub (ADMIN_HUB_URL/HUB_INTERNAL_TOKEN). | Hub connection is not configured (ADMIN_HUB_URL/HUB_INTERNAL_TOKEN). |
| `NOT_CONFIGURED` (409) | Workflow chưa sẵn sàng ở Hub (secret/khoá thiếu). | The workflow is not ready on the Hub (missing secret/key). |
| `CMD_MISSING_ARG` (422) | Dùng lại câu Chat `plan-frontend.md` §1.4: "Lệnh /{name} thiếu: {missing}." (+ dòng "Giá trị không hợp lệ: {invalid}." nếu có) | "/{name} is missing: {missing}." (+ "Invalid value: {invalid}.") |
| `INVALID_REFERENCE` (400) | Workflow/user không còn tồn tại. | The workflow or user no longer exists. |
| `FORBIDDEN` (403) | Bạn không có quyền chạy thử lệnh này. | You can't test this command. |
| `VALIDATION_ERROR` (400) | Cấu hình nháp chưa hợp lệ: {message} | Draft config is invalid: {message} |
| mạng | `auth.error.network` (có sẵn) | (có sẵn) |

## Hộp xác nhận `SIDE_EFFECT_CONFIRM_REQUIRED` (409)
`role="alertdialog"`; xác nhận ⇒ gửi lại cùng body kèm `confirm_side_effect:true`; Huỷ/Esc ⇒ đóng, không gửi.

| Phần | VI | EN |
|---|---|---|
| Câu | Workflow này có tác dụng phụ thật (gửi/ghi dữ liệu). Vẫn chạy thử? | This workflow has real side effects (it sends or writes data). Run the test anyway? |
| Nút xác nhận | Vẫn chạy | Run anyway |
| Nút đóng | Huỷ | Cancel |
