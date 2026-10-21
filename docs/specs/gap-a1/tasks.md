# gap-a1 — trang chi tiết HĐ: AI đọc lại, giao người, lịch sử, hoa hồng, tóm tắt AI (Luật 0b, làn nhanh)

Đối chiếu mgmt-app `cm-web pages/contracts/[id]` (chỉ tham khảo). Không migration (sự kiện `contract_events.type` tự do; cột `owner_user_id`,
`commission_pct`, `ai_read` có sẵn).

| # | Việc | Làn | Cách làm |
|---|------|-----|----------|
| 5 | "AI đọc lại từ đầu" + "Thử lại" khi đọc lỗi | nhanh | FE gọi `POST /contracts/:id/extract` có sẵn, hộp xác nhận; chỉ vai `write`. |
| 7 | "Giao cho" | đầy đủ (quyền) | `GET /assignees` (thành viên tenant ∩ nhóm có `read` gói), `PUT /contracts/:id/owner` (`write`, kiểm người nhận, event `owner_assigned`). |
| 4 | Lịch sử thay đổi | nhanh | `GET /contracts/:id/history` (`read`) dùng lại `activityRepo.record` ⇒ RLS luật thấy; panel mở/đóng, khác biệt trường. |
| 16 | Sửa hoa hồng % | nhanh | `PUT /contracts/:id/commission` (`write`, chỉ `deal = referral`, khoá `version`, event `commission_edited`); % thay thế số tiền cố định. |
| 17 | "Tạo tóm tắt bằng AI" | nhanh | `POST /contracts/:id/summary` (`write`, trần thao tác/ngày), AI client chung feature `contracts.summary` (usage), parse strict, ghi `ai_read.summary`, event `summary_generated`. |

## Quyết định trong lúc làm
- Mã lỗi riêng ở `MANAGE_ERRORS` (không đụng `CONTRACT_ERRORS`): `OWNER_INVALID` 422, `COMMISSION_NOT_ALLOWED` 422, `SUMMARY_NOT_ALLOWED` 409,
  `SUMMARY_UNAVAILABLE` 503; hết trần token ⇒ 429 `AI_CAP_EXCEEDED`.
- Giao người không tăng `version` (không phải trường form); sửa hoa hồng tăng `version`.
- AI gọi NGOÀI tx; không đè tóm tắt đã có (cập nhật có điều kiện).
- Chuỗi i18n ở tệp riêng `gapa1.{vi,en}.json` (đăng ký cuối `contracts-locales.ts`).

## Test
unit: `manage.usecase.test.ts`, `lib/manage.test.ts`; int: `tests/acceptance/GAP-A1/manage.int.test.ts` (mỗi endpoint một ca + viewer 403 + tenant khác 404);
e2e (chưa chạy): `e2e/contracts-web/gapa1-manage.cw.ts`.
