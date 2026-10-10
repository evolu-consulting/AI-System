# P · Phụ lục plan-frontend: i18n cho thread quy trình (U1)

Bổ sung [`plan-frontend-i18n.md`](plan-frontend-i18n.md) (quy ước §1 áp dụng). Màn: [`plan-frontend-thread.md`](plan-frontend-thread.md). Phần i18n mới **`thread`** (`locales/process/thread.{vi,en}.json`, khoá `process.thread.<tên>`): Bước 0 tạo khung rỗng, **PF1 viết**; khoá `ask.*` mới do PF2. Bước 0 thêm `thread` vào loader `process-locales.ts` và `i18n-check`. Không khoá số nhiều.

## 1. Khoá cũ: dùng lại / bỏ
| Nhóm cũ (i18n §5) | Số phận |
|---|---|
| `run.card.aria`, `run.card.title`, `run.line.*`, `run.runsAs`, `run.loadError`, `run.gone` | **dùng lại** (khối, thanh trạng thái) |
| `run.action.review/answer/decide` | dùng lại cho nút ở **khối timeline** (mở thread); `run.action.view/result/detail` chỉ còn ở thẻ Hỏi AI (`RunCard`) |
| `run.pane.versions/missing/noOutput/executor/attempt/history/openPage/lock/realAction` | dùng lại (tin `output`, `RunPage`); `run.pane.label`, `run.pane.close` **bỏ** (khung dùng `flow.panel`/nút đóng X2b) |
| `run.cancel.*`, `run.review.*`, `run.decision.*` | dùng lại nguyên (thẻ kiểm/quyết; `run.review.feedback` = tên textbox chế độ Góp ý) |
| `ask.*` | dùng lại; `ask.hintMulti` vẫn dùng khi chip gộp chèn vào ô; thêm §4 |

## 2. `thread` (PF1)
| Khoá | VI | EN |
|---|---|---|
| title | {{name}} · !{{key}} | {{name}} · !{{key}} |
| block.startedBy | {{name}} khởi chạy | Started by {{name}} |
| block.startedByMe | Bạn khởi chạy | You started it |
| block.openThread | Mở luồng | Open thread |
| chip.rework | Làm lại {{a}}/{{max}} | Rework {{a}}/{{max}} |
| chip.asks | Hỏi lại {{n}}/{{max}} | Questions {{n}}/{{max}} |
| output.title | Giai đoạn {{n}} · {{stage}} | Stage {{n}} · {{stage}} |
| output.aria | Kết quả {{stage}} v{{version}} | Result {{stage}} v{{version}} |
| output.by / byTeam | Làm bởi {{name}} / Làm bởi nhóm {{name}} | Done by {{name}} / Done by team {{name}} |
| output.summary | ✓ {{count}} bước · {{seconds}} · {{tokens}} token | ✓ {{count}} steps · {{seconds}} · {{tokens}} tokens |
| output.steps | Chi tiết {{count}} bước | Details of {{count}} steps |
| output.step | {{agent}} · {{model}} · {{seconds}} · {{tokens}} token | {{agent}} · {{model}} · {{seconds}} · {{tokens}} tokens |
| output.show / hide | Xem nội dung / Thu gọn | Show content / Collapse |
| output.auto | Tự chạy tiếp giai đoạn kế | Continues to the next stage automatically |
| role.agent / plan / member | Agent / Lập kế hoạch / Thành viên | Agent / Planner / Member |
| wait.review | Đang chờ {{names}} kiểm — chỉ người kiểm mới bấm được. | Waiting for {{names}} to review — only reviewers can act. |
| wait.ask | Đang chờ {{names}} trả lời | Waiting for {{names}} to answer |
| wait.decide | Đang chờ {{names}} hoặc quản trị viên quyết định | Waiting for {{names}} or an administrator to decide |
| wait.more | {{first}} và {{count}} người khác | {{first}} and {{count}} others |
| wait.group | nhóm {{group}} | group {{group}} |
| decision.stopped | Quy trình dừng ở giai đoạn {{stage}} | The process stopped at stage {{stage}} |
| result.aria | {{actor}} · {{result}} · {{time}} | {{actor}} · {{result}} · {{time}} |
| result.outside | ngoài phòng | outside the room |
| result.feedback | Góp ý | Feedback |
| result.answered | Đã trả lời | Answered |
| result.decided | đã chọn: {{option}} | chose: {{option}} |
| result.sections | Mục làm lại: {{list}} | Sections to rework: {{list}} |
| forward.line (`task_kind` review\|decision) | ↪ {{from}} đã chuyển việc cho {{to}} (lần {{depth}}/{{max}}) | ↪ {{from}} passed it to {{to}} (pass {{depth}}/{{max}}) |
| end.done | Lượt chạy hoàn tất | Run completed |
| end.cancelledBy | {{actor}} đã huỷ lượt chạy | {{actor}} cancelled the run |
| end.cancelled | Lượt chạy đã bị huỷ | The run was cancelled |
| end.failed | Lượt chạy gặp lỗi | The run failed |
| end.expired | Lượt chạy hết hạn (7 ngày không ai xử lý) | The run expired (7 days without action) |
| end.open | Mở trang lượt chạy | Open run page |
| hint | Đây là trao đổi giữa người với người; agent của quy trình không đọc. Muốn hỏi agent, nhắn ở khung chat chính của phòng. | This is a person-to-person thread; the process agents don't read it. To ask an agent, write in the room's main chat. |
| err.noAgent | Trong luồng quy trình không gọi được agent bằng @. Hãy gọi ở khung chat chính của phòng. | You can't call agents with @ in a process thread. Do it in the room's main chat. |
| mode.feedback | Chưa đạt · góp ý cho {{agent}} | Needs rework · feedback for {{agent}} |
| mode.answer | Trả lời {{agent}} | Answer {{agent}} |
| mode.cancel | Huỷ | Cancel |
| stale | Không tải được trạng thái quy trình | Couldn't load the process status |
| left | Bạn không còn ở phòng này. Xem lượt chạy ở trang riêng. | You are no longer in this room. View the run on its own page. |
Nhãn nút/textbox chế độ Góp ý và Trả lời **dùng khoá có sẵn**: `run.review.feedback` (textbox), `run.review.submit` (nút), `ask.answer` (textbox), `ask.send` (nút). Tên quy trình/giai đoạn/agent giữ nguyên từ Hub.

## 3. `ask` bổ sung (PF2)
| Khoá | VI | EN |
|---|---|---|
| ask.typed | Trả lời bằng văn bản | Answer in writing |
| ask.fwd.line (`task_kind=ask`) | ↪ {{from}} đã nhờ {{to}} trả lời (chuyển {{depth}}/{{max}}) | ↪ {{from}} asked {{to}} to answer (forward {{depth}}/{{max}}) |

## 4. Quy tắc dùng chữ
- "Bạn" thay tên khi `actor`/`from`/`starter` là người xem (`rooms.you` có sẵn). `{{names}}` ≤ 3 tên (`wait.more` cho phần còn lại; `group` ⇒ `wait.group`).
- Giây theo i18n §1 (`12,0s`); `{{tokens}}` bằng `Intl.NumberFormat`. Văn bản tin `content` của server (≤ 500 ký tự, locale mặc định tenant) **chỉ** dùng làm preview/fallback, không hiển thị khi `process` hợp lệ.
