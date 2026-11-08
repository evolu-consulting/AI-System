---
id: dlc-chat-review
title: Duyệt bước DLC ngay trong chat (nút "Xem và duyệt" + modal Duyệt / Từ chối)
lane: nhanh (chat-web + 1 route đọc gói dlc + cấu hình deploy; không đổi contract, không migration)
---
# dlc-chat-review (plan ngắn)

Vấn đề (Rowan 2026-11-03): demo DLC trên sohoptac2 dùng giao diện chat; task duyệt của gói `dlc` giao cho nhóm
"dlc – Nhân viên" (`open_tasks`, không vào `my_tasks`) nên chat không có chỗ duyệt plan — chỉ admin-web duyệt được.

| Việc | Trạng thái |
|---|---|
| `run-block/lib/dlc-review.ts`: chỉ run key `dlc-*`; task review mở (của tôi thắng task chung); Từ chối ⇒ `fail` + bước gần nhất trong `back_to_steps`, rỗng ⇒ làm lại chính bước đang duyệt | [x] |
| `DlcReviewDialog.tsx`: nút "Xem và duyệt" trên `RunCard` khi run DLC `waiting_review` ⇒ modal: kết quả đầy đủ (`OutputView`) + Duyệt / Từ chối (lý do bắt buộc, hiện bước sẽ quay lại) | [x] |
| `DlcConversationReview.tsx`: prod build `PUBLIC_FROZEN_MODULES` off ⇒ cổng engine off, thẻ run bị ẩn; thẻ "chờ duyệt" DLC hiện ở fallback của cổng (tự nạp chuỗi `process.*`, hỏi lại 15 s, lỗi/403 ⇒ ẩn) | [x] |
| hub `GET /pack/dlc/runs/:id/steps/:step` (`dlc.routes.ts`): nội dung đầy đủ của bước (spec ⇒ planText, report, verify, khác ⇒ kết quả gần nhất); được đọc khi run thấy được (`stepsView`) VÀ là người bắt đầu / admin / quyết được task mở; còn lại 404. Modal hiện bản này, rỗng/lỗi ⇒ bảng tóm tắt của stage | [x] |
| i18n `process.run.dlcReview.*` (vi/en) | [x] |
| deploy sohoptac2: `HUB_MAX_CONCURRENT_RUNS` mặc định 5 (bước DLC chờ người tính 1 run ⇒ 2 làm nghẽn chat); `deploy.ps1 -Key` | [x] |
| unit `dlc-review.test.ts` (4 ca), `dlc.routes.test.ts` (4 ca: đọc được, quyền, 404) | [x] |

## Quyết định trong lúc làm
- Không đổi `ReviewTaskCard`, trang `/runs/$id`, admin-web: các chỗ duyệt khác giữ nguyên (Rowan: "đừng apply cho mọi chỗ duyệt").
- "Từ chối quay lại bước trước đó" = bước cấu hình cho điểm duyệt (`after.back_to_steps`, lấy bước lớn nhất); không cấu hình ⇒
  làm lại chính bước vừa tạo kết quả (vd bước plan của DLC Bug Fix). Không cứng bước plan.
- Không bật `PUBLIC_FROZEN_MODULES` trên prod (sẽ mở phòng, menu `!`, hộp việc…); chỉ thẻ DLC nằm ngoài cờ.
- Quyền duyệt do Hub quyết (`POST /review-tasks/:id/decision`); lỗi hiện câu riêng (`reviewErrorMessage`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Duyệt bước DLC trong chat
Run của quy trình gói DLC (key `dlc-*`) đang chờ kiểm có nút "Xem và duyệt" trên thẻ run ở chat; modal hiện kết quả đầy đủ của bước, Duyệt cho quy trình đi tiếp, Từ chối (kèm lý do) quay lại bước cấu hình cho điểm duyệt hoặc làm lại chính bước đó.
- Kịch bản: khi run không phải DLC thì không có điểm duyệt DLC [test: apps/chat-web/src/features/processes/run-block/lib/dlc-review.test.ts » chỉ quy trình key dlc-*]
- Kịch bản: khi điểm duyệt không cấu hình bước quay lại thì Từ chối làm lại chính bước đang duyệt [test: apps/chat-web/src/features/processes/run-block/lib/dlc-review.test.ts » bước không cấu hình quay lại ⇒ làm lại chính bước đang duyệt]
- Kịch bản: khi người bắt đầu run mở modal bước plan thì thấy plan đầy đủ [test: apps/hub-api/src/modules/packs/dlc/adapters/dlc.routes.test.ts » người bắt đầu run đọc được plan đầy đủ của bước spec]
- Kịch bản: khi thành viên không liên quan đọc nội dung bước thì bị từ chối như không tồn tại [test: apps/hub-api/src/modules/packs/dlc/adapters/dlc.routes.test.ts » người quyết được task mở hoặc admin cũng đọc được, thành viên khác ⇒ 404]
- Kịch bản: khi điểm duyệt có cấu hình thì Từ chối quay lại bước gần nhất [test: apps/chat-web/src/features/processes/run-block/lib/dlc-review.test.ts » có cấu hình ⇒ quay lại bước gần nhất (lớn nhất) trong back_to_steps]

## Việc còn lại
- e2e chat cho modal chưa viết; thử tay trên sohoptac2 sau deploy.
