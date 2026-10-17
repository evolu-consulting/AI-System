# P-d-durable · plan frontend · câu chữ VI/EN nguyên văn (khoá i18n)

Phần của [`plan-frontend.md`](plan-frontend.md) / [`plan-frontend-d2.md`](plan-frontend-d2.md). **File này thắng** khi lệch. Mọi chuỗi qua khoá; đủ `vi` + `en`; chạy `bun run i18n:check`. Cách đặt khoá theo tiền lệ P-b2: chuỗi quy trình ở `packages/i18n/locales/process/<phần>.{vi,en}.json` (cây con của `process.<phần>`, tham số **`{{x}}`**; Admin tự đổi sang `{x}` bằng `toSingleBrace`), chuỗi màn tenant ở `packages/i18n/locales/{vi,en}.json` (`tenants.*`, tham số **`{x}`**). Cột Khoá viết đầy đủ từ `process.` hoặc `tenants.`. Số/ngày: định dạng bằng `Intl` ở code (FD7), không nằm trong chuỗi. Dấu ngoặc kép cong “ ” như các khoá hiện có.
Số nhiều: khoá `_one`/`_other` (`count`), VI hai bản giống nhau.

## 0. Dùng chung admin + chat — `process/common.{vi,en}.json`
| Khoá | VI | EN |
|---|---|---|
| `process.common.status.waiting_timer` | Đang chờ hẹn | Waiting for a scheduled time |
| `process.common.stage.skipped` | Bỏ qua | Skipped |
| `process.common.stageLabel.waitUntil` | Chờ tới {{date}} | Waiting until {{date}} |
| `process.common.stageLabel.waitUntilAt` | Chờ tới {{date}} ({{tz}}) | Waiting until {{date}} ({{tz}}) |
| `process.common.stageLabel.retrying` | Đang thử lại ({{n}}/{{max}}) | Retrying ({{n}}/{{max}}) |
| `process.common.stageLabel.retryingAt` | Đang thử lại ({{n}}/{{max}}) · {{time}} | Retrying ({{n}}/{{max}}) · {{time}} |
| `process.common.retry_exhausted` | Đã thử lại tối đa {{max}} lần mà vẫn lỗi. | Retried the maximum of {{max}} times and it still failed. |
| `process.common.retry_exhausted_hint` | Lỗi tạm thời (mất kết nối, quá thời gian…) vẫn chưa hết. Thử lại ngay, hoặc huỷ lượt chạy. | The temporary error (lost connection, timeout…) hasn't cleared. Retry now, or cancel the run. |
| `process.common.timer_invalid` | Ngày hẹn không hợp lệ hoặc đã quá hạn lượt chạy. | The scheduled date isn't valid or is past the run's expiry. |
| `process.common.timer_invalid_hint` | Thiếu ngày, ngày sai, xa quá 730 ngày hoặc sau ngày hết hạn của lượt chạy. Chọn tính lại ngày hẹn, bỏ chờ để đi tiếp, hoặc huỷ. | The date is missing or wrong, more than 730 days away, or after the run expires. Recalculate the date, skip the wait to continue, or cancel. |
| `process.common.tool_failed` (P-d2) | Gọi tool bị lỗi. | The tool call failed. |
| `process.common.tool_failed_hint` (P-d2) | Tool đã bị tắt cho công ty, hoặc trả lỗi hay kết quả sai mẫu. Xem lại rồi chọn cách xử lý. | The tool was turned off for the company, or it returned an error or a result that doesn't match. Review it, then choose what to do. |
| `process.common.option.add_attempt_retry_exhausted` | Thử lại ngay | Retry now |
| `process.common.option.add_attempt_timer_invalid` | Tính lại ngày hẹn | Recalculate the date |
| `process.common.option.use_current_timer_invalid` | Bỏ chờ, đi tiếp | Skip the wait and continue |
`reasonHintKey` thêm `retry_exhausted`, `timer_invalid`, `tool_failed`; `reasonParams`: `retry_exhausted` ⇒ `{max: 3}`.

## 1. Admin · editor quy trình P-d1 — `process/admin.{vi,en}.json`
| Khoá | VI | EN |
|---|---|---|
| `process.admin.editor.stage.kind.wait` | Chờ tới ngày | Wait until date |
| `process.admin.editor.stage.wait.title` | Chờ tới ngày | Wait until date |
| `…wait.hint` | Dừng giai đoạn này tới một ngày hẹn rồi tự chạy tiếp. Không dùng agent và không có bước duyệt. | Pauses the run at this stage until a set date, then continues on its own. No agent and no review step. |
| `…wait.valid` | Hợp lệ | Valid |
| `…wait.from` | Lấy ngày từ | Take the date from |
| `…wait.fromPh` | Chọn nguồn ngày… | Choose a date source… |
| `…wait.fromInput` | Thông tin đầu vào · {{label}} | Input · {{label}} |
| `…wait.fromField` | Kết quả giai đoạn {{n}} · {{stage}} · {{field}} | Stage {{n}} output · {{stage}} · {{field}} |
| `…wait.fromNone` | Chưa có nguồn ngày nào. Thêm trường đầu vào kiểu Ngày, hoặc khai báo trường kiểu Ngày ở giai đoạn trước. | There is no date source yet. Add a Date input field, or declare a Date field in an earlier stage. |
| `…wait.offset` | Chênh lệch (ngày) | Offset (days) |
| `…wait.offsetHint` | Số âm = trước ngày gốc, 0 = đúng ngày, số dương = sau. | Negative = before the base date, 0 = on the day, positive = after. |
| `…wait.time` | Giờ trong ngày | Time of day |
| `…wait.tz` | Theo múi giờ công ty: {{tz}} ({{offset}}). Ngày hẹn được chốt lúc lượt chạy vào giai đoạn này; đổi múi giờ công ty sau đó không tính lại. | Uses the company time zone: {{tz}} ({{offset}}). The due time is fixed when the run reaches this stage; changing the company time zone later does not recalculate it. |
| `…wait.tzTemplate` | Quy trình mẫu: tính theo múi giờ của công ty chạy quy trình (mặc định {{tz}}). | Template: uses the time zone of the company that runs it (default {{tz}}). |
| `…wait.tzLoading` | Đang tải múi giờ… | Loading time zone… |
| `…wait.tzError` | Không tải được múi giờ công ty. | Couldn't load the company time zone. |
| `…wait.formula.before_one/_other` | Tới hạn lúc {{time}}, {{count}} ngày trước ngày lấy từ {{source}}. | Due at {{time}}, {{count}} day(s) before the date from {{source}}. (`_one`: “1 day”, `_other`: “{{count}} days”) |
| `…wait.formula.on` | Tới hạn lúc {{time}}, đúng ngày lấy từ {{source}}. | Due at {{time}}, on the date from {{source}}. |
| `…wait.formula.after_one/_other` | Tới hạn lúc {{time}}, {{count}} ngày sau ngày lấy từ {{source}}. | Due at {{time}}, {{count}} day(s) after the date from {{source}}. |
| `…wait.after` | Chạy tiếp (cố định) | Continue (fixed) |
| `…wait.err.source` | Chọn nguồn ngày. | Choose a date source. |
| `…wait.err.offset` | Từ −365 đến 365 ngày. | From −365 to 365 days. |
| `…wait.err.time` | Nhập giờ dạng HH:mm, ví dụ 09:00. | Enter a time as HH:mm, for example 09:00. |
| `…wait.err.WAIT_INVALID` | Nguồn ngày không hợp lệ. Chọn trường nhập kiểu Ngày hoặc trường Ngày của giai đoạn ở bước trước. | The date source isn't valid. Pick a Date input field or a Date field from a stage in an earlier step. |
| `…stage.remindEvery` | Nhắc mỗi (giờ) | Remind every (hours) |
| `…stage.remindHint` | Để trống = nhắc một lần sau 24 giờ. Nhắc tối đa 10 lần. | Leave empty = one reminder after 24 hours. Up to 10 reminders. |
| `…stage.escalate` | Chuyển cấp nếu chưa ai kiểm | Escalate if nobody has reviewed |
| `…stage.escalateAfter` | Chuyển cấp sau (giờ) | Escalate after (hours) |
| `…stage.escalateGroup` | Chuyển cấp tới nhóm | Escalate to group |
| `…stage.escalateHint` | Nhóm này được thêm vào việc kiểm; nhóm kiểm ban đầu vẫn duyệt được. Chỉ chuyển cấp một lần và không tự chấm Đạt. | This group is added to the review; the original group can still review. It escalates once and never marks Pass by itself. |
| `…stage.err.remind` | Từ 4 đến 168 giờ. | From 4 to 168 hours. |
| `…stage.err.escalateAfter` | Từ 4 đến 2.160 giờ. | From 4 to 2,160 hours. |
| `…stage.err.escalateGroup` | Chọn nhóm khác với nhóm kiểm. | Pick a group other than the reviewing group. |
| `…stage.err.ESCALATE_INVALID` | Cấu hình chuyển cấp chưa hợp lệ: chọn nhóm khác nhóm kiểm và thời gian từ 4 đến 2.160 giờ. | The escalation isn't valid: pick a group other than the reviewing group and a time from 4 to 2,160 hours. |
| `process.admin.editor.ttl` | Thời hạn lượt chạy (ngày) | Run time limit (days) |
| `…editor.ttlHint` | Lượt chạy chưa xong quá số ngày này sẽ hết hạn. Lượt đang chạy không đổi khi bạn sửa. | A run not finished within this many days expires. Runs already in progress aren't affected when you edit. |
| `…editor.noExpiry` | Không hết hạn | No expiry |
| `…editor.err.ttl` | Từ 1 đến 365 ngày, hoặc chọn Không hết hạn. | From 1 to 365 days, or choose No expiry. |
| `…editor.limitsTextTtl` | Tối đa {{days}} ngày · 5 lượt cùng lúc · làm lại ≤ 3 lần mỗi giai đoạn · nhắc người kiểm sau 1 ngày. Chạm giới hạn → “Cần người quyết”. | Up to {{days}} days · 5 runs at once · ≤ 3 reworks per stage · reviewer reminded after 1 day. Hitting a limit → “Needs a decision”. |
| `…editor.limitsTextNoTtl` | Không hết hạn · 5 lượt cùng lúc · làm lại ≤ 3 lần mỗi giai đoạn · nhắc người kiểm sau 1 ngày. Chạm giới hạn → “Cần người quyết”. | No expiry · 5 runs at once · ≤ 3 reworks per stage · reviewer reminded after 1 day. Hitting a limit → “Needs a decision”. |
| `…editor.limitsWait` | Lượt đang chờ tới ngày không tính vào 5 lượt cùng lúc. | Runs waiting for a date don't count toward the 5 concurrent runs. |
| `…editor.inputs.types.date` | Ngày | Date |
| `…canvas.node.wait` | Chờ tới ngày | Wait until date |
| `…run.log.kinds.escalate` | Chuyển cấp | Escalate |
| `…run.log.kinds.branch` (P-d2) | Rẽ nhánh | Branch |
`limitsText` (khoá cũ) giữ cho tới khi mọi nơi dùng chuyển sang hai khoá mới; với `{{days}}` = 7 `limitsTextTtl` cho đúng chữ cũ (e2e cũ không vỡ).

## 2. Chat-web P-d1 — `process/{run,thread,inbox,inputs}.{vi,en}.json`
| Khoá | VI | EN |
|---|---|---|
| `process.run.line.waitingTimer` | Chờ tới {{date}} · Giai đoạn {{n}}/{{total}} · {{stage}} | Waiting until {{date}} · Stage {{n}}/{{total}} · {{stage}} |
| `process.run.line.waitingTimerNoDate` | Đang chờ hẹn · Giai đoạn {{n}}/{{total}} | Waiting for a scheduled time · Stage {{n}}/{{total}} |
| `process.run.line.retrying` | Đang thử lại ({{retry}}/{{max}}) · Giai đoạn {{n}}/{{total}} · {{stage}} | Retrying ({{retry}}/{{max}}) · Stage {{n}}/{{total}} · {{stage}} |
| `process.run.review.escalated` | Đã chuyển cấp | Escalated |
| `process.run.review.escalatedNote` | Việc này đã được chuyển cấp tới nhóm {{group}} vì chưa ai kiểm. Nhóm kiểm ban đầu vẫn kiểm được. | This review was escalated to the group {{group}} because nobody has reviewed it. The original group can still review. |
| `process.thread.wait.reviewEscalated` | Đang chờ {{names}} hoặc {{escalated}} (đã chuyển cấp) kiểm — chỉ người kiểm mới bấm được. | Waiting for {{names}} or {{escalated}} (escalated) to review — only reviewers can act. |
| `process.thread.end.expired` (đổi) | Lượt chạy hết hạn ({{days}} ngày không ai xử lý) | The run expired ({{days}} days without action) |
| `process.thread.end.expiredGeneric` | Lượt chạy hết hạn (quá thời hạn của quy trình) | The run expired (past the process time limit) |
| `process.inbox.notice.escalated` | Việc ở {{process}} · {{stage}} đã chuyển cấp tới nhóm của bạn | {{process}} · {{stage}} was escalated to your group |
| `process.inbox.run.log.escalate` | Hệ thống chuyển cấp tới nhóm {{group}} | The system escalated to group {{group}} |
| `process.inputs.err.date.invalid` | Chọn một ngày hợp lệ. | Choose a valid date. |
Ghi chú: `thread.wait.reviewEscalated` dùng `thread.wait.group` ("nhóm {{group}}") cho `{{escalated}}`. Khoá hiện có `thread.end.expired` đổi cả VI lẫn EN (EN cũ: “The run expired (7 days without action)”).

## 3. Admin · màn tenant P-d1 — `locales/{vi,en}.json` (`tenants.*`, `{x}`)
| Khoá | VI | EN |
|---|---|---|
| `tenants.field.timezone` | Múi giờ | Time zone |
| `tenants.field.timezoneHint` | Dùng để tính ngày giờ hẹn của quy trình (ví dụ giờ 09:00). Đổi múi giờ không tính lại các hẹn đã lưu. | Used to work out the scheduled times of processes (for example 09:00). Changing the time zone does not recalculate times already saved. |
| `tenants.timezone.change` | Đổi múi giờ | Change time zone |
| `tenants.timezone.search` | Tìm múi giờ | Search time zones |
| `tenants.timezone.value` | {tz} ({offset}) | {tz} ({offset}) |
| `tenants.error.timezoneRequired` | Chọn múi giờ | Choose a time zone |
| `tenants.error.timezoneUnsupported` | Múi giờ này chưa được hỗ trợ. Chọn một múi giờ khác trong danh sách. | This time zone isn't supported. Choose another one from the list. |

## 4. P-d2
### 4.1 Admin editor — `process/admin.{vi,en}.json`
| Khoá | VI | EN |
|---|---|---|
| `process.admin.editor.stage.kind.tool` | Gọi tool | Call tool |
| `…tool.title` | Gọi tool | Call tool |
| `…tool.hint` | Gọi một workflow của công ty bằng quyền của người bắt đầu, không dùng agent. Kết quả được lọc theo các trường bạn khai báo ở mục Kết quả. | Calls one of the company's workflows with the starter's permissions, without an agent. The result is filtered by the fields you declare under Output. |
| `…tool.pick` | Tool | Tool |
| `…tool.pickPh` | Chọn tool… | Choose a tool… |
| `…tool.option` | {{name}} · {{key}} | {{name}} · {{key}} |
| `…tool.loading` | Đang tải tool… | Loading tools… |
| `…tool.loadError` | Không tải được danh sách tool. | Couldn't load the tool list. |
| `…tool.empty` | Chưa có tool nào được bật cho công ty — liên hệ quản trị nền tảng | No tool is enabled for your company yet — contact the platform admin |
| `…tool.template` | Quy trình mẫu không chọn được “Gọi tool”. Chép mẫu về công ty để chọn tool. | Templates can't use “Call tool”. Copy the template to your company to pick a tool. |
| `…tool.sideEffect` | Tác dụng phụ | Side effects |
| `…tool.sideEffectNote` | Tool này tạo tác dụng thật. Giai đoạn cần bật “Hành động thật”, và mọi giai đoạn ở bước trước phải có người kiểm. | This tool has real effects. The stage needs “Real action” on, and every stage in the previous step needs a reviewer. |
| `…tool.argSource` | Nguồn của tham số {{name}} | Source of parameter {{name}} |
| `…tool.argValue` | Giá trị của tham số {{name}} | Value of parameter {{name}} |
| `…tool.from.const` | Giá trị cố định | Fixed value |
| `…tool.from.input` | Thông tin đầu vào | Input |
| `…tool.from.field` | Kết quả giai đoạn trước | Output of an earlier stage |
| `…tool.argPh` | Chọn nguồn… | Choose a source… |
| `…tool.fieldOpt` | Giai đoạn {{n}} · {{field}} | Stage {{n}} · {{field}} |
| `…tool.inputOpt` | {{key}} · {{label}} | {{key}} · {{label}} |
| `…tool.required` | bắt buộc | required |
| `…tool.paramType.text` / `.paragraph` / `.select` / `.number` / `.file` | Chữ / Đoạn văn / Chọn / Số / Tệp | Text / Paragraph / Choice / Number / File |
| `…tool.fileUnsupported` | Tham số tệp chưa dùng được trong quy trình, nên tool này chưa chọn được. | File parameters can't be used in processes yet, so this tool can't be picked. |
| `…tool.err.argRequired` | Chọn nguồn cho tham số này. | Choose a source for this parameter. |
| `…tool.err.TOOL_INVALID` | Tool chưa khai báo đủ: điền mọi tham số bắt buộc từ nguồn có thật (tối đa 20 tham số, không dùng tham số tệp). | The tool isn't fully set up: fill every required parameter from a real source (up to 20 parameters, no file parameters). |
| `…tool.err.TOOL_SIDE_EFFECT` | Tool có tác dụng phụ chỉ dùng được khi giai đoạn bật “Hành động thật”. | A tool with side effects can only be used when the stage has “Real action” on. |
| `…tool.err.ref` | Tool này chưa được bật cho công ty hoặc không còn. | This tool isn't enabled for your company or no longer exists. |
| `…branch.title` | Rẽ nhánh | Branch |
| `…branch.hint` | Luật đầu tiên khớp được dùng. Không khớp luật nào thì sang bước kế. Giai đoạn bị nhảy qua hiện là “Bỏ qua”. | The first matching rule wins. If none match, the run goes to the next step. Skipped stages show as “Skipped”. |
| `…branch.field` | Nếu trường | If field |
| `…branch.op` | Phép so sánh | Comparison |
| `…branch.value` | Giá trị | Value |
| `…branch.goto` | Thì tới bước | Then go to step |
| `…branch.gotoPh` | Chọn bước… | Choose a step… |
| `…branch.gotoOpt` | Bước {{n}} | Step {{n}} |
| `…branch.add` | Thêm luật rẽ nhánh | Add a branch rule |
| `…branch.remove` | Xoá luật {{n}} | Remove rule {{n}} |
| `…branch.ops.eq` / `ne` / `lt` / `le` / `gt` / `ge` | bằng / khác / nhỏ hơn / nhỏ hơn hoặc bằng / lớn hơn / lớn hơn hoặc bằng | equals / is not / is less than / is at most / is greater than / is at least |
| `…branch.locked` | Chỉ giai đoạn đứng một mình trong bước mới rẽ nhánh được. | Only a stage that is alone in its step can branch. |
| `…branch.noFields` | Khai báo trường có cấu trúc ở mục Kết quả trước. | Declare structured fields under Output first. |
| `…branch.max` | Tối đa 10 luật. | Up to 10 rules. |
| `…branch.err.field` | Luật {{n}}: chọn trường của giai đoạn này. | Rule {{n}}: choose a field of this stage. |
| `…branch.err.op` | Luật {{n}}: phép so sánh này chỉ dùng cho trường Số hoặc Ngày. | Rule {{n}}: this comparison only works for Number or Date fields. |
| `…branch.err.value` | Luật {{n}}: nhập giá trị đúng kiểu của trường. | Rule {{n}}: enter a value of the field's type. |
| `…branch.err.goto` | Luật {{n}}: chọn bước đích, phải đứng sau giai đoạn này. | Rule {{n}}: pick a target step that comes after this stage. |
| `…branch.err.real` | Bước đích có Hành động thật nên giai đoạn này phải do người duyệt (Sau giai đoạn = Duyệt bởi Group). | The target step has a Real action stage, so this stage must be reviewed (After the stage = Reviewed by a group). |
| `…branch.err.BRANCH_INVALID` | Luật rẽ nhánh chưa hợp lệ: kiểm tra trường, phép so sánh, giá trị và bước đích. | A branch rule isn't valid: check the field, comparison, value and target step. |
| `…canvas.node.tool` | Gọi tool | Call tool |
| `…canvas.node.sideEffect` | Tác dụng phụ | Side effects |
| `…canvas.node.branch_one/_other` | Rẽ nhánh · {{count}} luật | Branch · {{count}} rule(s) (`_one` “1 rule”, `_other` “{{count}} rules”) |
| `…canvas.edge.branch` | Rẽ nhánh · luật {{n}} | Branch · rule {{n}} |
| `…canvas.list.branch` | Rẽ nhánh: luật {{n}} tới bước {{step}} | Branch: rule {{n}} to step {{step}} |
### 4.2 Chat — `process/thread.{vi,en}.json`, `inbox`
| Khoá | VI | EN |
|---|---|---|
| `process.thread.branch` | Rẽ nhánh: tới bước {{step}} (luật {{rule}}) | Branch: going to step {{step}} (rule {{rule}}) |
| `process.inbox.run.log.branch` | Rẽ nhánh: tới bước {{step}} (luật {{rule}}) | Branch: going to step {{step}} (rule {{rule}}) |
### 4.3 Admin · tab Tool quy trình — `locales/{vi,en}.json` (`tenants.*`, `{x}`)
| Khoá | VI | EN |
|---|---|---|
| `tenants.tab.workflowTools` | Tool quy trình | Process tools |
| `tenants.tools.title` | Tool quy trình | Process tools |
| `tenants.tools.desc` | Bật workflow nào thì quy trình của công ty này gọi được workflow đó ở giai đoạn “Gọi tool”. | A workflow you enable here can be called by this company's processes at a “Call tool” stage. |
| `tenants.tools.search` | Tìm tool | Search tools |
| `tenants.tools.col.name` / `key` / `note` / `grantedBy` / `on` | Tên / Ký hiệu / Ghi chú / Bật bởi / Bật cho công ty | Name / Key / Note / Enabled by / Enabled for company |
| `tenants.tools.sideEffect` | Tác dụng phụ | Side effects |
| `tenants.tools.workflowOff` | Workflow đang tắt | Workflow is off |
| `tenants.tools.workflowOffTip` | Workflow đang tắt toàn hệ thống nên tool chưa dùng được dù đã bật cho công ty. | The workflow is off system-wide, so the tool can't be used even though it's enabled for this company. |
| `tenants.tools.grantedBy` | {name} · {date} | {name} · {date} |
| `tenants.tools.switchAria` | Bật tool {name} | Enable tool {name} |
| `tenants.tools.empty` | Chưa có workflow nào trong catalog. Tạo workflow ở mục Workflows, rồi bật cho công ty ở đây. | There are no workflows in the catalog. Create one under Workflows, then enable it for this company here. |
| `tenants.tools.openWorkflows` | Mở Workflows | Open Workflows |
| `tenants.tools.noMatch` | Không có tool nào khớp. | No tool matches. |
| `tenants.tools.offTitle` | Tắt tool {name}? | Turn off tool {name}? |
| `tenants.tools.offBody` | Lượt chạy đang chờ gọi tool này sẽ dừng ở “Cần người quyết”. | Runs waiting to call this tool will stop at “Needs a decision”. |
| `tenants.tools.offConfirm` | Tắt tool | Turn off tool |
| `tenants.tools.toast.on` | Đã bật tool {name} cho {tenant} | Enabled tool {name} for {tenant} |
| `tenants.tools.toast.off` | Đã tắt tool {name} cho {tenant} | Turned off tool {name} for {tenant} |
| `tenants.tools.toast.gone` | Workflow này không còn trong catalog. Đã tải lại danh sách. | This workflow is no longer in the catalog. The list was reloaded. |
