---
id: eng-card-ui
lát: eng-card-ui
cr: CR-107
làn: nhanh
migration: không
phụ thuộc: eng-reliable
---
## Plan (ngắn)
CR-107 phần C — thẻ duyệt HĐ (contracts-web) hiện `attention` và hết poll vô hạn:
1. Banner khi `attention` có: needs_decision ⇒ "Quy trình đang dừng: <lý do>" + từ lúc nào; owner/admin gói có **Thử lại** / **Huỷ & mở lại** (hộp xác nhận); người khác thấy "Báo chủ hợp đồng để xử lý". stalled ⇒ lý do dễ hiểu (FLOW_GROUP_MISSING ⇒ nêu mã phòng ban) + nút Mở lại có sẵn. Hub cũ (không có `attention`) giữ đường cũ.
2. `engineAdvancing` = false khi có `attention` (hết poll 2 s vô hạn lúc run `needs_decision`). Chờ chuyển bước = push `/me/stream` (`process.updated` / `review_task.created` của đúng `run_id`) + lưới an toàn giãn dần 2·4·8·16·30 s (trần 30 s, tối đa 10 lần), không poll khi có `attention`.

## Làm
- [x] `lib/attention.ts` (lý do → khoá i18n, nút theo quyền) + test; `lib/advance-wait.ts` (backoff, lọc sự kiện theo run) + test; `engineAdvancing` + test.
- [x] `stream/process-stream.ts` (đọc `/me/stream` bằng `apiResponse` + `createSseParser`), `hooks/use-approval-push.ts`, `use-approval.ts` (refetchInterval, retry/cancelReopen), `AttentionBanner.tsx`, `api.ts`, mã lỗi → câu (`APPROVAL_GROUP_MISSING`, `ENGINE_UNAVAILABLE`, `FORBIDDEN`), i18n vi+en.
- [x] e2e (viết, không chạy): `e2e/contracts-web/contract-flow.cw.ts` thêm 1 test banner owner/editor.

## Quyết định trong lúc làm
- contracts-web dùng chung `@ai/web-kit/http` (Bearer + refresh) với hub ⇒ `/me/stream` mở được, không cần backend mới. Bỏ `Last-Event-ID`: chỉ cần "có gì đổi" ⇒ tải lại thẻ; nối lại sau đứt ⇒ tải lại một lần để bù sự kiện lỡ.
- Nối lại stream giãn 1→30 s chỉ khi đứt (không phải chờ trạng thái); 401 sau refresh ⇒ dừng. Chỉ nghe khi lượt engine cấp 1 có `run_id`; run mới sau Huỷ & mở lại đổi `run_id` ⇒ lọc bằng ref.
- 409/422 sau Thử lại / Huỷ & mở lại ⇒ báo lỗi + tải lại thẻ để banner khớp thực tế. Bước AI đọc (`extract/value/finalize`) giữ poll 2 s như cũ (hữu hạn).
- Mã 403 của gói không rõ ⇒ map theo mã `FORBIDDEN`/`PACK_FORBIDDEN`; mã lạ ⇒ câu chung.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED sht/duyet-ky-so.md
#### Yêu cầu: Thẻ duyệt hiện lý do dừng và cho owner xử lý
Khi `ContractApproval.attention` có giá trị, thẻ duyệt của HĐ hiện banner "Quy trình đang dừng: <lý do dễ hiểu>" kèm thời điểm. Owner/admin gói với `needs_decision` thấy **Thử lại** (`POST …/approval/retry`) và **Huỷ & mở lại** (`POST …/approval/cancel-reopen`, có hộp xác nhận); với `stalled` thấy **Mở lại quy trình**; người khác chỉ thấy "Báo chủ hợp đồng để xử lý". Mã lỗi 409/422/503/403 hiện câu tiếng Việt riêng.
- Kịch bản: khi lý do là `FLOW_GROUP_MISSING:<mã>` thì banner nêu mã phòng ban cần thêm [test: apps/workspace-web/src/features/contract-approval/lib/attention.test.ts » attentionText]
- Kịch bản: khi người xem là owner thì needs_decision có Thử lại + Huỷ & mở lại, người khác chỉ có câu báo chủ hợp đồng [test: apps/workspace-web/src/features/contract-approval/lib/attention.test.ts » attentionActions]
- Kịch bản: khi run needs_decision thì owner thấy banner + hai nút, editor thấy câu báo chủ HĐ [test: e2e/contracts-web/contract-flow.cw.ts » CR-107 needs_decision: banner và nút theo quyền]

### ADDED sht/duyet-ky-so.md
#### Yêu cầu: Thẻ duyệt chờ engine bằng push, không poll vô hạn
Thẻ duyệt không tải lại định kỳ khi có `attention`. Khi engine đang chuyển bước, thẻ nghe `/me/stream` (`process.updated`, `review_task.created` của đúng run) để tải lại; lưới an toàn tải lại giãn dần 2·4·8·16·30 s (trần 30 s, tối đa 10 lần) chỉ khi đang chuyển bước và không có `attention`.
- Kịch bản: khi run ở needs_decision thì không còn coi là đang chuyển bước (hết poll) [test: apps/workspace-web/src/features/contract-approval/lib/engine-card.test.ts » engineAdvancing]
- Kịch bản: khi chờ chuyển bước thì độ trễ tải lại là 2·4·8·16·30 s rồi dừng sau 10 lần [test: apps/workspace-web/src/features/contract-approval/lib/advance-wait.test.ts » advanceDelay]
- Kịch bản: khi sự kiện quy trình tới thì chỉ tải lại nếu thuộc đúng run của thẻ [test: apps/workspace-web/src/features/contract-approval/lib/advance-wait.test.ts » eventConcernsRun]

## Việc còn lại
- e2e chưa chạy (chạy một lần cuối đợt); chưa test tay luồng `/me/stream` thật với hub.
- Thông báo chuông cho owner khi lượt kẹt (CR-107 phần A, việc còn lại).
