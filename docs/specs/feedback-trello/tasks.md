# feedback-trello · góp ý về app → thẻ Trello

Làn nhanh (một agent). Lỗi báo: góp ý gửi trên platform mới không lên Trello (module chỉ lưu DB + trang admin).

## Plan
1. `feedback.trello.ts`: `cardName` ([Loại] đầu nội dung, ≤ 120), `cardDesc` (nội dung + công ty + người gửi + app/trang/phiên bản + mã), `pushFeedbackToTrello` (POST `/1/cards`, rồi `/1/cards/{id}/attachments` multipart từng tệp), `trelloFromEnv`.
2. `createFeedback` gọi push SAU commit, không `await` (`void`), nên không chặn người dùng; mỗi request timeout 5 s; mọi lỗi chỉ `logger.warn` (tên lỗi/HTTP status, không message gốc).
3. Env admin-api `TRELLO_API_KEY`, `TRELLO_TOKEN`, `TRELLO_FEEDBACK_LIST_ID` (`config/env.ts`); thiếu một ⇒ `undefined` ⇒ bỏ qua. `server.ts` -> `AppDeps.trello` -> chỉ `/auth/feedback`.
4. Tên biến (giá trị trống) thêm vào `.env.example`, `.env.production.example`, `deploy/prod-sohoptac2/env.template`.

## Quyết định
- Key/token đặt trong body (form/multipart), không trong query ⇒ không rò vào URL/log lỗi; logger đã che khoá chứa key/token.
- Không thêm cột `trello_card_url` (không có nơi UI dùng; tránh migration admin) — hàm trả URL thẻ sẵn để nối sau.
- `gen-env.sh` không sửa: không sinh secret; `env.template` đã liệt kê tên, giá trị đặt tay trong `.env` trên server.
- Fire-and-forget: tiến trình chết giữa chừng thì mất thẻ (góp ý vẫn lưu); chấp nhận, không có hàng đợi.

## Việc còn lại
- Server: đặt 3 biến trong `.env` rồi up lại admin-api (user/deploy làm).
- Test: unit `feedback.trello.test.ts`; không chạy int/e2e theo yêu cầu.
