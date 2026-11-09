---
id: cr126-inbox-ceo
lát: cr126-inbox-ceo
cr: CR-126
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
«Việc của tôi» cho giám đốc: mỗi dòng nói điều đang duyệt «quy trình · đối tác · số tiền · người đề xuất · ngày»; một kiểu dòng cho ký / duyệt HĐ / việc yêu cầu, sắp theo hạn rồi chờ lâu nhất; chip Tất cả · Cần duyệt · Cần ký.

## Làm
- Hub: `GET /me/review-tasks` thêm `process_run.request {title, partner, amount}` từ phiếu của lượt (cùng câu SQL, join lượt cha cho lượt con; không truy vấn thêm). `notify/task-request-summary.ts`.
- Web: `overview/lib/inbox.ts` (dựng dòng, tóm tắt, sắp, lọc), `InboxRowList.tsx`, `ApprovalsInboxPage`, `use-inbox` (+`itemByTask`), i18n vi+en.

## Không làm / Chạm
- Không đụng RequestPage/RequestsPage. Dòng duyệt HĐ không thuộc lượt quy trình chỉ có «số · tên HĐ» (`/my-work` chưa có đối tác/số tiền).

## Test tối thiểu
unit `task-request-summary.test.ts`, `inbox.test.ts`; int: `purchase-child-task.int.test.ts` (số tiền lượt con lấy từ phiếu lượt cha).

## Quyết định trong lúc làm
- Đối tác = ô text có khoá/nhãn nói về đối tác/NCC/khách; tiền = ô kiểu `money` đầu tiên (phiếu chưa có kiểu «đối tác»).
- «Cần duyệt» = mọi việc không phải ký.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-09 (đợt cr126-wave)

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: «Việc của tôi» nói rõ điều đang duyệt
Mỗi dòng của «Việc của tôi» là một kiểu chung cho ký, duyệt HĐ và việc yêu cầu: nhãn bước, rồi «quy trình · đối tác/NCC · số tiền · người đề xuất · ngày» lấy từ phiếu của lượt (phần thiếu thì bỏ). Sắp theo hạn gần nhất, rồi việc chờ lâu nhất. Chip «Tất cả · Cần duyệt · Cần ký» lọc danh sách.
- Kịch bản: khi lượt có phiếu thì `/me/review-tasks` trả số tiền của phiếu (lượt con lấy phiếu lượt cha) [test: apps/hub-api/src/modules/processes/nodes/subprocess/purchase-child-task.int.test.ts » CR-126 · việc đầu của lượt con hiện trong «Chờ tôi duyệt»]
- Kịch bản: khi phiếu có ô tiền và ô nhà cung cấp thì tóm tắt lấy đúng hai ô, thiếu thì null [test: apps/hub-api/src/modules/processes/notify/task-request-summary.test.ts » requestSummary]
- Kịch bản: khi có việc ký, duyệt, yêu cầu thì sắp hạn trước rồi chờ lâu nhất và chip lọc đúng [test: apps/workspace-web/src/features/overview/lib/inbox.test.ts » inbox rows]

## Việc còn lại
- e2e chưa chạy (giữ testid cũ; `approval-tasks`/`signing-tasks` không còn, `requests-waiting` bao mọi dòng).
- Dòng duyệt HĐ ngoài lượt quy trình chưa có đối tác/số tiền (cần thêm vào `/my-work`).
