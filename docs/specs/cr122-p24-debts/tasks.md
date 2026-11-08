---
id: cr122-p24-debts
lát: cr122-p24-debts
cr: CR-122
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Dọn nợ nhỏ CR-122 (resume.md "Nợ nhỏ"). Mỗi mục: nguyên nhân gốc → sửa → test.

## Làm
1. Mở lại khi lượt đã có run (công ty bật flow): trước đây rơi sang đường "Mở lại" CŨ (tính lại mẫu duyệt cũ ⇒ ghi sai lý do FLOW_MISSING/FLOW_ROUTE_NONE). Nay: run còn chạy ⇒ 409 `not_stalled`; run đã kết thúc bất thường ⇒ bỏ gắn run cũ + phát lại `contract.submitted` (flow-resend.usecase, rearmFlow `detachRun`).
2. pending_links rỗng: thẻ máy cũ cấp 1 (nháp) khi flow BẬT chỉ báo `finalizes_on_approve` theo ngưỡng giá trị cũ ⇒ HĐ lớn không mở hộp "Gắn sản phẩm" ⇒ mất SP. Nay `getApproval` báo `true` khi flow bật + người xem xác nhận được; `holdForFlow` đã lưu `products` vào `pending_links`.
3. Push `/me/stream` thẻ duyệt so `process_run_id` của sự kiện với `run_id` (= id lượt duyệt của gói) ⇒ không bao giờ khớp. Nay so với `engine_run_id` (`pushRunIdOf`).
4. i18n `APPROVAL_FLOW_STARTING` + `GROUPS_MISSING` (lỗi thao tác + lý do thẻ), vi + en.
5. e2e `cr122-p24-not-assigned.spec.ts` (công ty mới `e2e-c22n-*`, cờ bật, chưa gán flow ⇒ lý do + Mở lại, không còn Xác nhận và lưu).
6. "Xác nhận và lưu" còn trên thẻ cũ sau khi gửi: `staleAfterConfirm` + `headRule.submitted`.
7. admin-web RunHeader: lý do `missing_fact` ⇒ "Thiếu <khoá> — điền vào hợp đồng rồi Thử lại" (RunDetail thêm `decision_missing`).
8. KHÔNG làm: đổi khoá Dify `contract-*` sang `_` (xem Việc còn lại).

## Không làm / Chạm
Không chạm pack-scope.ts, esign/RLS, canvas admin-web, DLC.

## Test tối thiểu
- unit: advance-wait, approval-head, head-rule, run-detail.map (missingOf), attention.
- int: not-launched.int.test.ts (Mở lại khi run kẹt; xác nhận kèm SP ⇒ pending_links + hộp SP).
- e2e: journey-approval cr122-p24-not-assigned (1 lần).

## Quyết định trong lúc làm
- Mục 7 hiện khoá dữ kiện thô (chưa dịch sang nhãn trường): hub chưa có bảng nhãn cho admin.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED sht/chung-tu.md
#### Yêu cầu: Mở lại quy trình duyệt khi công ty dùng flow theo sự kiện
Lượt chờ flow chưa có run hoặc có run đã kết thúc bất thường ⇒ "Mở lại" phát lại sự kiện gửi duyệt và nói đúng lý do; run đang chạy ⇒ báo bước duyệt đã đổi, không đụng. Thẻ báo đúng lý do (kể cả lỗi mở quy trình / thiếu phòng ban) bằng câu nghiệp vụ.
- Kịch bản: Mở lại khi run flow đã kẹt ⇒ lượt mở lại bằng flow, không rơi sang máy cũ [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » p24 · Mở lại khi lượt đã có run kẹt]
- Kịch bản: Mở lại khi run flow còn chạy ⇒ not_stalled, run giữ nguyên [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » p24 · Mở lại khi lượt đã có run kẹt]
- Kịch bản: chưa gán quy trình ⇒ thẻ nêu lý do + Mở lại [test: e2e/journey-approval/cr122-p24-not-assigned.spec.ts » chưa gán quy trình: thẻ nói rõ lý do]

#### Yêu cầu: Xác nhận và lưu giữ sản phẩm chọn lúc xác nhận khi bật flow
Cờ flow bật ⇒ hộp "Gắn sản phẩm" luôn mở ở nháp (không tuỳ ngưỡng giá trị), SP lưu ở lượt và gắn khi flow Đã duyệt. Sau khi gửi duyệt, thẻ cũ không còn nút Xác nhận và lưu.
- Kịch bản: xác nhận kèm SP ⇒ pending_links có SP, thẻ báo hộp SP [test: apps/hub-api/src/modules/processes/triggers/not-launched.int.test.ts » p24 · cờ flow bật: thẻ nháp luôn mở hộp SP]
- Kịch bản: thẻ cũ sau xác nhận ẩn nút [test: apps/workspace-web/src/features/contract-review/lib/head-rule.test.ts » p24 · đã gửi duyệt]
- Kịch bản: push theo run engine [test: apps/workspace-web/src/features/contract-approval/lib/advance-wait.test.ts » pushRunIdOf (p24)]

#### Yêu cầu: Chi tiết lượt chạy nêu dữ liệu còn thiếu
Lượt dừng vì `missing_fact` ⇒ đầu trang nêu "Thiếu <trường> — điền rồi Thử lại".
- Kịch bản: RunDetail mang decision_missing [test: apps/hub-api/src/modules/processes/runs/run-detail.map.test.ts » missingOf (p24 · missing_fact)]

## Việc còn lại
- Mục 8: đổi khoá Dify hyphen → underscore: KHÔNG làm trong lát này — khoá `contract-title|deal|value|partner` còn là placeholder trong thân node Thông báo đã lưu (`{contract-title}`) và ở ~10 file test/acceptance; cần migration hub 0116 viết lại def đã lưu (cả text mẫu) + đổi test hàng loạt (> 45 phút).
- Nhãn trường (thay khoá thô) cho `missing_fact` ở admin-web.
