---
id: cr125-quick-sign-link
lát: cr125-quick-sign-link
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Nút thư "Xem hợp đồng và ký" trỏ `/contracts/c/<id>?ky=1#esign-panel`. Trang HĐ (EsignPanel) thấy `ky=1` + đúng lượt + chưa ký ⇒ chạy đúng handler nút "Ký ngay" (hộp chọn cách ký nếu >1 cách), rồi bỏ `ky` khỏi URL.

## Làm
- hub-api `esign-invite.ts`: `signInviteLink`.
- workspace-web `esign-view.ts`: `decideAutoSign`, `hasSignIntent`; `EsignPanel.tsx`: effect một lần, dùng chung `signNowOf`.

## Không làm / Chạm
Không đổi auth/token/phiên; chưa đăng nhập ⇒ guard `/login?next=<href>` đã giữ nguyên query (`safeNext` giữ `?…`).

## Test tối thiểu
Unit `esign-invite.test.ts`, `esign-view.test.ts`; int `esign-invite.int.test.ts`.

## Quyết định trong lúc làm
Không đúng lượt / đã ký ⇒ trang thường với trạng thái hiện có; `ky` luôn bị bỏ sau khi trạng thái tải xong.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### MODIFIED sht/email-moi-ky-so.md
#### Yêu cầu: Nút trong email Mời ký đưa thẳng tới bước ký
Liên kết là `/contracts/c/<id>?ky=1#esign-panel`. Người ký đã đăng nhập, đúng lượt, chưa ký ⇒ trang tự mở bước ký như bấm "Ký ngay"; chưa đăng nhập ⇒ đăng nhập rồi quay lại đúng liên kết; không đúng lượt hoặc đã ký ⇒ trang HĐ thường. Tham số `ky` bị bỏ khỏi URL sau khi xử lý.
- Kịch bản: khi dựng thẻ mời ký thì liên kết có `?ky=1` [test: apps/hub-api/src/modules/packs/contracts/application/esign-invite.test.ts » liên kết sâu tới thẻ ký]
- Kịch bản: khi ky=1 nhưng không đúng lượt hoặc đã ký thì không tự ký [test: apps/workspace-web/src/features/contract-esign/lib/esign-view.test.ts » decideAutoSign: tự mở CHỈ khi ky]

## Việc còn lại
Không có e2e mới (chưa viết); chạy hành trình thật ở cuối đợt.
