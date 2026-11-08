---
id: cr125-fix-errors
lát: cr125-fix-errors
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa H2 + M2–M5 của `docs/specs/CR-125/wave-review-2.md` và gợi ý ops `flow_flag`; thêm bước A10a vào checklist deploy.

## Làm
- H2: `step` của lỗi kiểm quy trình = số thứ tự TỪ 1 (hợp đồng, `publish-issue-step.ts`); hub đổi ở `explainIssue`, web đổi ngược ở `issueStepIndex`. Mẫu chung `PUBLISH_ISSUE_STEP_FIXTURE` dùng cho test hub và test web.
- M2: readiness trả `reasons[]` = `{code, params}` (4 mã `READINESS_*`) + `missing.locked`; câu chữ ở i18n; mã vào `check:error-codes`. `FLOW_TEMPLATE_NOT_READY` trả `reasons` + `audience`, không còn câu.
- M3: `SLOT_LOCKED` vào `PUBLISH_ISSUE_EXTRA_RULES` + khoá `err.SLOT_LOCKED` vi/en.
- M4/M5: `ReadinessPanel` hiện lý do + nút "Thử lại" khi không tải được; lỗi nút sửa theo mã (`fixError.<mã>`).
- Ops: gợi ý `flow_flag` không bảo gỡ gán nữa. Checklist deploy: A10a liệt kê tenant trước migrate.

## Không làm / Chạm
EsignPanel, DLC, e2e đã khoá. Bỏ câu tiếng Việt cứng trong admin-api `FEATURE_NOT_NEEDED` (để lát sau; web đã dịch theo mã).

## Test tối thiểu
Unit: contracts template-readiness, hub library-publish.messages + flow-flag, web publish-issues + readiness-view. Int: company-flows-readiness (evotest -Dirty).

## Quyết định trong lúc làm
- `step` số luôn từ 1; chuỗi chữ số cũng từ 1; `path` thô vẫn đếm từ 0.
- Mã readiness chỉ cho lý do CHẶN; nhóm thiếu chỉ là lưu ý (khoá `readiness.group`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/company-flows.md
#### Yêu cầu: Lý do mẫu chưa dùng được là mã + biến, web dịch
Hub trả lý do chặn dưới dạng mã và biến (bước, khoá tính năng/tool), kèm danh sách bước cố định; web dịch bằng i18n. Khi không tải được kiểm tra, màn hình nói lý do và có nút Thử lại; lỗi nút sửa nói đúng bước kế theo mã lỗi.
- Kịch bản: khi mẫu có bước cố định thì readiness trả mã READINESS_STEP_LOCKED và tên bước trong dữ liệu [test: packages/contracts/src/modules/template-readiness.test.ts » bước khe cố định (slot)]
- Kịch bản: khi gán mẫu chưa dùng được thì 422 trả mã và biến, không có câu chữ [test: apps/hub-api/src/modules/processes/library/company-flows-readiness.int.test.ts » sao chép mẫu chưa dùng được]
- Kịch bản: khi không tải được readiness thì hiện lý do theo mã lỗi [test: apps/admin-web/src/features/tenants/flows/lib/readiness-view.test.ts » lỗi tải / lỗi nút sửa]

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Số bước trong lỗi xuất bản đếm từ 1 ở cả hub và web
`step` là số thứ tự từ 1; web trỏ đúng bước bị lỗi. `SLOT_LOCKED` có câu hướng dẫn riêng.
- Kịch bản: khi lỗi ở `steps.2` thì hub trả step 3 và web nhảy tới chỉ số 2 [test: apps/hub-api/src/modules/processes/library/library-publish.messages.test.ts » hợp đồng bước TỪ 1]
- Kịch bản: khi web nhận step 3 thì chỉ số bước là 2 [test: apps/admin-web/src/features/processes/lib/publish-issues.test.ts » hợp đồng bước TỪ 1]

### MODIFIED engine/company-flows.md
#### Yêu cầu: Gợi ý check flow_flag không bảo gỡ gán
Gợi ý nói công ty đang tạm dừng quy trình và cách bật lại ở Cài đặt nếu không cố ý.
- Kịch bản: khi có công ty lệch cờ thì hint chứa "bật lại ở Cài đặt nếu không cố ý" [test: apps/hub-api/src/modules/ops/adapters/checks/flow-flag.check.test.ts » có công ty lệch ⇒ warn]

## Việc còn lại
- Admin-api `FEATURE_NOT_NEEDED` còn message tiếng Việt cứng (web không còn hiện).
- Mở rộng `check:error-codes` quét mọi literal `libError(..., { issues })` (phần cuối M3) chưa làm.
