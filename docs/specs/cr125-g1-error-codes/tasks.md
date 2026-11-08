---
id: cr125-g1-error-codes
lát: cr125-g1-error-codes
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Audit #12 + check 7 (`docs/specs/CR-125/consistency-audit.md`, nhóm G1): mã lỗi kiểm quy trình một nguồn. Hub trả `code + params`
(không câu chữ), một khoá i18n mỗi mã (`process.admin.library.form.err.<MÃ>`), web dịch; `check:error-codes` giữ vậy.

## Làm
- `packages/contracts/.../publish-issue-codes.ts` (mới): `PUBLISH_ISSUE_CODES` (= `APPROVAL_FLOW_RULES` + 10 mã riêng thư viện), `PUBLISH_ISSUE_KEY`, `publishIssueParams` (giới hạn lấy từ hằng chung). Gỡ `ESIGN_STEP_TEXT` (câu VI/EN trong contracts).
- `SlotIssueSchema`: bỏ `message`/`message_en`, thêm `code`, `params`.
- Hub `library-publish.messages.ts`: chỉ còn `{path, rule, step, field, code, params}`; bỏ ~30 câu VI/EN.
- admin-web `publish-issues.ts` / `PublishDialog` / `FlowStatusBar.issueText`: dịch bằng khoá của mã + biến Hub trả; xoá `library.rule.*` (trùng `SYSTEM_TOOL_MISSING`, `UNREACHABLE_STEP`).
- i18n `process/admin.{vi,en}`: khối `library.form.err` đủ 31 mã (câu "nói cách sửa" của Hub chuyển sang đây), thêm `apiError.FLOW_NONE_ASSIGNED` (mã Hub chưa có câu).
- `check:error-codes` (+ `slice-rebase` POST_REBASE_GATES, `bun run check`).

## Không làm / Chạm
Không chạm: i18n run/thread, toast, globals.css, SlotCard, ops, nav, DLC, e2e. `contracts.flow.err.*` (workspace, v2l + esignflow), `process.admin.flow.err.*`,
`process.admin.flow.esign.err.*` giữ làm khoá riêng của trình sửa luồng từng app (khai ở `SHARED_PREFIXES` của check) — gộp khi G6/G9.

## Test tối thiểu
unit: `publish-issue-codes.test.ts`, `esign-step-rules.test.ts`, `library-publish.messages.test.ts`, `publish-issues.test.ts`, `check-error-codes.rules.test.ts`, `slice-rebase.test.ts`;
int: `library-validate.int.test.ts` (422 PROCESS_PUBLISH_INVALID / SLOT_GROUPS_MISSING trả mã + biến).

## Quyết định trong lúc làm
- Khoá chuẩn = `process.admin.library.form.err` (đã có, FlowStatusBar dùng) thay vì tạo không gian mới; câu "nói cách sửa" của Hub thắng câu ngắn cũ.
- `rule` giữ nguyên (`COND_FIELD_UNDECLARED:due_date`), thêm `code` + `params` để web không phải tự tách.
- Hub chỉ đánh số `step` từ 1; web vẫn suy chỉ số nhảy như trước (không đổi ở lát này).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Lỗi kiểm quy trình khi xuất bản / gán trả mã và biến, web dịch
Hub trả mỗi vi phạm dạng `{path, rule, step, field, code, params}` (không có câu chữ); admin-web dịch bằng đúng một khoá i18n cho mỗi mã
(`process.admin.library.form.err.<MÃ>`) với biến Hub trả, kèm "Bước N" khi có bước; mã lạ hiện câu chung kèm mã. Mã chưa có câu (`FLOW_NONE_ASSIGNED`) cũng có câu nói cách khắc phục.
- Kịch bản: khi xuất bản quy trình có điều kiện dùng thông tin chưa khai báo thì Hub trả 422 với `code`=`COND_FIELD_UNDECLARED`, `params.param` và không có `message` [test: apps/hub-api/src/modules/processes/library/library-validate.int.test.ts » PROCESS_PUBLISH_INVALID]
- Kịch bản: khi gán quy trình cho công ty thiếu mã phòng ban thì Hub trả `GROUP_MISSING_IN_TENANT` với `params.key` và `params.tenant` [test: apps/hub-api/src/modules/processes/library/library-publish.messages.test.ts » missingGroupIssues]
- Kịch bản: khi Hub trả `DUE_RANGE` kèm `min`,`max` thì admin hiện câu của khoá mã đó kèm "Bước N" [test: apps/admin-web/src/features/processes/lib/publish-issues.test.ts » parsePublishIssues]

### ADDED engine/check-error-codes.md
#### Yêu cầu: check:error-codes chặn mã lỗi hai nguồn
Mỗi mã lỗi khai ở `packages/contracts` có đúng một khoá i18n chuẩn mỗi ngôn ngữ, không có khoá `.err.<MÃ>`/`.apiError.<MÃ>` thứ hai ngoài tiền tố riêng đã khai; hub (ngoài test) không có câu tiếng Việt cạnh mã đó. Chạy trong `bun run check` và cổng sau rebase của `slice:merge`.
- Kịch bản: khi một mã thiếu khoá hoặc có khoá thứ hai thì check đỏ nêu mã và khoá [test: tools/scripts/src/check-error-codes.rules.test.ts » check:error-codes · khoá i18n]
- Kịch bản: khi hub có câu tiếng Việt ngay sau một mã lỗi thì check đỏ nêu file và dòng [test: tools/scripts/src/check-error-codes.rules.test.ts » check:error-codes · hub không chứa câu tiếng Việt]
- Kịch bản: cổng sau rebase chạy check:error-codes [test: tools/scripts/src/slice-rebase.test.ts » cổng sau rebase]

## Việc còn lại
- `contracts.flow.err.*` (workspace-web) còn bản riêng cho `ESIGN_*`, `DUE_RANGE`, `REMIND_RANGE`, `STEPS_MAX`… (khai ở `SHARED_PREFIXES`) ⇒ hợp nhất khi G6.
- `check:error-codes` mới phủ `PUBLISH_ISSUE_CODES` + `HUB_ADMIN_LIBRARY_ERRORS`; các bộ `*_ERRORS` khác của contracts chưa vào `CODE_SETS`.
- `indexOf` của `publish-issues.ts` coi `step` số là chỉ số từ 0 trong khi Hub trả từ 1 (có từ trước, chưa sửa).
