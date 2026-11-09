---
id: cr126-request-page
lát: cr126-request-page
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Trang yêu cầu (workspace-web) nói rõ cho người duyệt: ai đang giữ việc, tóm tắt phiếu, nút làm việc ở đầu trang, Phần hiện tại mở sẵn.

## Làm
- `lib/request-view.ts` (thuần): `waitingOf/waitingText`, `summaryOf/summaryText`, `approvedBy`, `currentNode`.
- `RequestPage`: tóm tắt dưới tên, dòng «Đang chờ: …» / «Đã hoàn tất», thanh việc của tôi ở ĐẦU trang (`StepActions` = `RunStepActions`, một component, cây không vẽ lại nút), lời sau khi gửi «Đã gửi. Bước tiếp: … duyệt…», link «Việc kế tiếp» sau quyết định.
- `RequestStepsTree`: Phần hiện tại mở sẵn, các Phần khác bấm mở.
- `StepRow`: bước đã duyệt «Duyệt bởi X, dd/mm». `RunStepActions`: nút Từ chối kiểu danger.
- API không đổi: `FlowStepView` đã có assignee / decided_by / decided_at.

## Không làm / Chạm
Không chạm inbox (ApprovalsInboxPage/ApprovalRowList/useInbox), RequestsPage, hub-api.

## Test tối thiểu
unit `request-view.test.ts`; không e2e trong lát (testid request-approve… giữ nguyên, nay nằm trong `request-action-bar`).

## Quyết định trong lúc làm
- «Phần N» = thứ tự lượt trong cây (gốc = Phần 1); một lượt duy nhất ⇒ không ghi «Phần».
- Người đề xuất lấy từ ô phiếu khớp tên, không có ⇒ người gửi lượt (`run.started_by`).
- NewRequestPage không đổi (lời sau gửi hiện ở trang yêu cầu sau khi chuyển trang).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

### MODIFIED engine/manual-start-ui.md
#### Yêu cầu: Trang yêu cầu nói rõ ai đang giữ việc và cho làm việc ngay đầu trang (nguồn: cr126-request-page)
Trang yêu cầu hiện «Đang chờ: <người/nhóm> · Phần N – <bước>» (gộp chờ duyệt / cần quyết định / chờ trả lời) hoặc «Đã hoàn tất», tóm tắt «<đối tác> · <tổng tiền> · Người đề xuất <tên>» từ ô phiếu, nút Gửi / Duyệt / Trả lại / Từ chối của người xem ở đầu trang (một component), Phần hiện tại mở sẵn, bước đã duyệt ghi «Duyệt bởi X, dd/mm», sau khi gửi nói bước tiếp, nút Từ chối kiểu cảnh báo, sau quyết định có link «Việc kế tiếp».
- Kịch bản: khi bước đang mở có người nhận và lượt có nhiều Phần thì dòng chờ ghi người và «Phần N – tên bước»; lượt xong ghi «Đã hoàn tất» [test: apps/workspace-web/src/features/requests/lib/request-view.test.ts » waitingOf]
- Kịch bản: khi phiếu có đối tác, tổng tiền, người đề xuất thì tóm tắt nối bằng « · », thiếu ô nào bỏ ô đó [test: apps/workspace-web/src/features/requests/lib/request-view.test.ts » summaryOf]
- Kịch bản: khi bước đã duyệt thì hiện «Duyệt bởi X, dd/mm» [test: apps/workspace-web/src/features/requests/lib/request-view.test.ts » approvedBy]
- Kịch bản: khi cây có nhiều Phần thì Phần có bước đang mở là Phần hiện tại, mở sẵn [test: apps/workspace-web/src/features/requests/lib/request-view.test.ts » currentNode: bước mở > gốc]
