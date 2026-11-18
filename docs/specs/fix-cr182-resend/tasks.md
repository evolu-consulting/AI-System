---
id: fix-cr182-resend
lát: fix-cr182-resend
cr: CR-182
làn: nhanh
migration: không
phụ thuộc: cr182-partner-api, cr182-partner-web
---
## Plan (ngắn)
Lỗi e2e (UAT P05): người tải lên không thấy «Gửi lại link» / «Sao chép link» ở thẻ chờ đối tác khi HĐ đang duyệt, vì web dựa vào `can_prep` của tệp (= false khi HĐ đã khoá).

## Làm
- [x] Máy chủ: `PartnerLinkStatusOut.can_resend` (`packages/contracts/.../doc-sign.ts`), tính bằng `canResendLink` (người tải lên HĐ ∨ quản trị) — CÙNG hàm với route `resend` (G1) — cho cả `GET /contracts/:id/partner-sign` và `partner_link` của phiên ký; «quản trị» lấy ở `adapters/partner-sign.admin.ts` (một nguồn cho 3 route).
- [x] Web: `canResend(session)` = `session.partner_link?.can_resend`, bỏ `can_prep`.
- [x] Unit (rules + web) + int.

## Quyết định trong lúc làm
- `can_resend` là trường bắt buộc (không tuỳ chọn) để mọi nơi dựng trạng thái link phải nói rõ; sau khi `resend` thành công trả `true`.
- Người tải lên = `contracts.created_by` (cùng nghĩa với route resend).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED pack-contracts/ky-tren-tai-lieu.md
#### Yêu cầu: Chỉ người tải lên hoặc quản trị thấy «Gửi lại link ký» kể cả khi hợp đồng đang duyệt
Trạng thái link ký của đối tác (phiên ký và trang hợp đồng) có cờ `can_resend` do máy chủ tính bằng đúng luật của lệnh gửi lại: người tải lên hợp đồng hoặc quản trị công ty; không phụ thuộc hợp đồng đã khoá để duyệt hay chưa. Người xem thường không có.
- Kịch bản: khi hợp đồng đang duyệt thì người tải lên và quản trị có can_resend, người xem thường không [test: apps/hub-api/src/modules/packs/contracts/adapters/partner-sign.int.test.ts » can_resend: người tải lên ⇒ true, quản trị ⇒ true, người xem thường ⇒ false, không phụ thuộc trạng thái khoá của HĐ]
- Kịch bản: khi dựng trạng thái link thì mang đúng cờ và không lộ email hay băm [test: apps/hub-api/src/modules/packs/contracts/domain/partner-sign.rules.test.ts » statusOut mang cờ can_resend của máy chủ, không lộ email/băm]
- Kịch bản: khi người tải lên mở thẻ chờ đối tác lúc tệp đã khoá thì vẫn thấy nút gửi lại [test: apps/workspace-web/src/features/doc-sign/lib/partner-link-view.test.ts » người tải lên lúc HĐ đã khoá (can_prep=false) vẫn thấy nút khi máy chủ báo can_resend]
