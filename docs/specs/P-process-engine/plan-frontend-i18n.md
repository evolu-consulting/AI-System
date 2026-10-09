# P · Phụ lục plan-frontend: i18n và câu chữ VI/EN

Thuộc [`plan-frontend.md`](plan-frontend.md) FD3. Nguyên văn để e2e (nhãn VI mặc định e2e). `{{x}}` = tham số i18next. Khoá đầy đủ = `process.<phần>.<tên>`; bảng dưới ghi `<phần>.<tên>`. Không dùng khoá số nhiều (`vi`/`en` phải cùng tập khoá — `i18n:check`). Mỗi PF viết phần của mình vào đúng file `locales/process/<phần>.{vi,en}.json`; `common` do Bước 0.

## 1. Quy ước
| Mục | Quy tắc |
|---|---|
| Nạp | `ensureProcessLocale(lng)` khi engine `on` + khi `languageChanged`; thiếu khoá ⇒ lùi `vi` (`fallbackLng` hiện có) |
| Số/giờ | số `Intl.NumberFormat(lang)`, thời gian tương đối dùng `relativeTime` có sẵn (chat), giây `12,0s` (vi) / `12.0s` (en) |
| Tên người | `UserRef.display_name`; tên giai đoạn/quy trình/agent lấy nguyên từ Hub (không dịch); `ExecutorRef.name` theo `i18n.language` |

## 2. `common` — trạng thái
| Khoá | VI | EN |
|---|---|---|
| status.running | Đang chạy | Running |
| status.waiting_review | Chờ kiểm | Waiting for review |
| status.waiting_answer | Chờ trả lời | Waiting for an answer |
| status.needs_decision | Cần người quyết | Needs a decision |
| status.done | Hoàn tất | Done |
| status.cancelled | Đã huỷ | Cancelled |
| status.failed | Lỗi | Failed |
| status.expired | Hết hạn | Expired |
| stage.pending / stage.queued | Chưa tới / Đang xếp hàng | Not started / Queued |
| result.pass / fail / answer | Đạt / Chưa đạt / Đã trả lời | Passed / Needs rework / Answered |
| result.add_attempt / use_current / cancel | Thêm 1 lần làm lại / Dùng bản hiện có / Huỷ lượt chạy | Allowed 1 more rework / Used current version / Cancelled the run |
| result.cancelled / expired / superseded | Đã huỷ / Hết hạn / Đã có người khác xử lý | Cancelled / Expired / Handled by someone else |
| option.add_attempt | Thêm 1 lần làm lại | Allow 1 more rework |
| option.use_current | Dùng bản hiện có | Use current version |
| option.cancel | Huỷ lượt chạy | Cancel run |
| sender.name | Quy trình | Processes |
| error.load | Không tải được. | Couldn't load. |
| error.retry | Thử lại | Try again |
| error.notFound | Không tìm thấy | Not found |
| error.network | Mất kết nối. Thử lại. | Connection lost. Try again. |

## 3. `common` — lý do "Cần người quyết" (`DECISION_REASONS`, khoá `reason.<mã>`)
| Mã | VI | EN |
|---|---|---|
| redo_limit | Đã làm lại tối đa {{max}} lần mà chưa đạt. | Reached the maximum of {{max}} reworks without approval. |
| ask_limit | Agent đã hỏi lại tối đa {{max}} lần ở giai đoạn này. | The agent asked follow-up questions the maximum of {{max}} times in this stage. |
| template_invalid | Kết quả chưa đúng mẫu bắt buộc. | The output doesn't match the required template. |
| team_calls | Nhóm agent đã dùng hết số lượt gọi cho phép. | The agent team used all its allowed calls. |
| team_tokens | Nhóm agent đã dùng hết ngân sách token. | The agent team used its whole token budget. |
| team_time | Nhóm agent chạy quá thời gian cho phép. | The agent team ran longer than allowed. |
| team_no_change | Nhóm agent không còn cải thiện kết quả sau 2 lần gọi liên tiếp. | The agent team stopped improving the result after 2 consecutive calls. |
| job_timeout | Giai đoạn chạy quá thời gian cho phép. | The stage ran longer than allowed. |
| stage_tokens | Giai đoạn đã vượt ngân sách token. | The stage exceeded its token budget. |
| run_tokens | Lượt chạy đã vượt ngân sách token. | The run exceeded its token budget. |
| agent_failed | Agent báo lỗi khi chạy giai đoạn này. | The agent failed while running this stage. |
| permission_lost | Người bắt đầu không còn quyền dùng agent hoặc quy trình này. | The person who started the run no longer has access to this agent or process. |
| user_inactive | Tài khoản người bắt đầu đã bị khoá hoặc ngừng hoạt động. | The starter's account is locked or inactive. |
| interrupted | Giai đoạn bị gián đoạn (lượt chạy bị dừng hoặc hệ thống khởi động lại). | The stage was interrupted (the run was stopped or the system restarted). |

## 4. `composer` — menu `!`, gửi, lỗi
| Khoá | VI | EN |
|---|---|---|
| menu.label | Quy trình | Processes |
| menu.title | Quy trình bạn được chạy · gõ tiếp để lọc | Processes you can run · keep typing to filter |
| menu.loading | Đang tải quy trình… | Loading processes… |
| menu.empty | Chưa có quy trình nào bạn được chạy | You can't run any process yet |
| menu.noMatch | Không có quy trình khớp “!{{q}}” | No process matches “!{{q}}” |
| menu.error | Không tải được danh sách quy trình | Couldn't load the process list |
| menu.stages | {{count}} giai đoạn | {{count}} stage(s) |
| menu.escape | Muốn gửi chữ bắt đầu bằng “!”, gõ “!!”. | To send text that starts with “!”, type “!!”. |
| button | Quy trình | Processes |
| hint.default | Gõ @ để hỏi agent, ! để chạy quy trình | Type @ to ask an agent, ! to run a process |
| hint.room | Enter để khởi chạy · tiến độ hiện trong phòng này | Press Enter to start · progress shows in this room |
| hint.ai | Enter để khởi chạy · tiến độ hiện ở thẻ phía trên khung nhập | Press Enter to start · progress shows on the card above the box |
| placeholder.group | Nhắn cho nhóm… gõ @ để hỏi agent, ! để chạy quy trình | Message the group… type @ to ask an agent, ! to run a process |
| placeholder.dm | Nhắn cho {{name}}… gõ @ để hỏi agent, ! để chạy quy trình | Message {{name}}… type @ to ask an agent, ! to run a process |
| error.notFound | Không tìm thấy quy trình “!{{key}}”. | Process “!{{key}}” not found. |
| error.tooMany | Công ty đang chạy tối đa {{max}} quy trình cùng lúc. Thử lại sau {{n}} giây. | Your company is already running {{max}} processes. Try again in {{n}} seconds. |
| error.noAttach | Quy trình chưa nhận tệp đính kèm. Gỡ tệp hoặc bỏ “!” rồi gửi lại. | Processes don't accept attachments yet. Remove the files or drop the “!” and send again. |
| toast.started | Đã bắt đầu quy trình {{name}} | Started process {{name}} |
| toast.open | Mở | Open |

## 5. `run` và `ask` — thẻ, pane, kiểm, quyết, hỏi lại
| Khoá | VI | EN |
|---|---|---|
| run.card.aria | Quy trình {{name}} | Process {{name}} |
| run.card.title | Quy trình · {{name}} | Process · {{name}} |
| run.line.running | Đang chạy · Giai đoạn {{n}}/{{total}} · {{stage}} | Running · Stage {{n}}/{{total}} · {{stage}} |
| run.line.queued | Đang xếp hàng · Giai đoạn {{n}}/{{total}} | Queued · Stage {{n}}/{{total}} |
| run.line.reviewMe / reviewOther | Chờ bạn kiểm / Chờ người kiểm | Waiting for your review / Waiting for a reviewer |
| run.line.askMe / askOther | Cần bạn trả lời / Chờ {{name}} trả lời | Needs your answer / Waiting for {{name}} to answer |
| run.line.decideMe / decideOther | Cần bạn quyết định / Cần người quyết · {{reason}} | Needs your decision / Needs a decision · {{reason}} |
| run.line.redo | làm lại {{n}}/{{max}} | rework {{n}}/{{max}} |
| run.line.next | Giai đoạn {{n}} đang chạy | Stage {{n}} is running |
| run.action.view / review / answer / decide | Xem tiến độ / Kiểm ngay / Trả lời / Quyết định | View progress / Review now / Answer / Decide |
| run.action.result / detail | Xem kết quả / Xem chi tiết | View result / View details |
| run.runsAs | Chạy bằng quyền của {{name}} | Runs with {{name}}'s permissions |
| run.conversation.title | Quy trình trong hội thoại này | Processes in this conversation |
| run.loadError | Không tải được quy trình | Couldn't load the process |
| run.gone | Bạn không còn xem được lượt chạy này | You can no longer view this run |
| run.pane.label | Quy trình đang mở | Open process |
| run.pane.close | Đóng | Close |
| run.pane.executor | Làm bởi {{name}} | Done by {{name}} |
| run.pane.attempt | Lần {{a}} · còn {{n}} lần làm lại | Attempt {{a}} · {{n}} reworks left |
| run.pane.versions | Phiên bản | Versions |
| run.pane.missing | Thiếu mục bắt buộc: {{list}} | Missing required sections: {{list}} |
| run.pane.noOutput | Chưa có kết quả | No output yet |
| run.pane.lock / realAction | Có người kiểm / Hành động thật | Has a reviewer / Real action |
| run.pane.history | Lịch sử ({{n}}) | History ({{n}}) |
| run.pane.openPage | Mở trang lượt chạy | Open run page |
| run.cancel.button | Huỷ lượt chạy | Cancel run |
| run.cancel.title / body | Huỷ lượt chạy này? / Lượt chạy dừng hẳn, kết quả đã có vẫn xem được. | Cancel this run? / The run stops for good; existing results stay viewable. |
| run.cancel.confirm / keep | Xác nhận huỷ / Giữ lại | Yes, cancel / Keep running |
| run.cancel.done | Đã huỷ lượt chạy | Run cancelled |
| run.review.region | Kiểm {{stage}} | Review {{stage}} |
| run.review.title | {{agent}} cần bạn kiểm trước khi chạy tiếp | {{agent}} needs your review before continuing |
| run.review.pass / passHint | Đạt / Chạy tiếp giai đoạn kế | Pass / Continue to the next stage |
| run.review.fail / failHint | Chưa đạt / Ghi góp ý để làm lại | Needs rework / Write feedback for a rework |
| run.review.feedback | Góp ý cho {{agent}} (bắt buộc) | Feedback for {{agent}} (required) |
| run.review.help | {{agent}} sẽ làm lại theo góp ý (còn {{n}} lần). | {{agent}} will rework it using your feedback ({{n}} left). |
| run.review.submit / cancel | Gửi góp ý · làm lại / Huỷ | Send feedback · rework / Cancel |
| run.review.waiting | Đang chờ người kiểm | Waiting for a reviewer |
| run.review.taken | Đã có người khác quyết | Someone else already decided |
| run.review.passed | Đã duyệt giai đoạn {{stage}} | Stage {{stage}} approved |
| run.review.sent | Đã gửi góp ý. {{agent}} sẽ làm lại ({{n}} lần còn lại) | Feedback sent. {{agent}} will rework it ({{n}} left) |
| run.review.closed | {{name}} · {{result}} · {{time}} | {{name}} · {{result}} · {{time}} |
| run.decision.region | Cần người quyết | Needs a decision |
| run.decision.title | Quy trình dừng ở giai đoạn {{stage}} | The process stopped at stage {{stage}} |
| run.decision.note | Ghi chú (tuỳ chọn) | Note (optional) |
| run.decision.waiting | Đang chờ {{name}} hoặc quản trị viên quyết định | Waiting for {{name}} or an administrator to decide |
| run.decision.noOutput | Chưa có bản nào để dùng | There is no version to use yet |
| run.decision.done | Đã ghi quyết định | Decision recorded |
| ask.title | {{agent}} cần thêm thông tin · lần hỏi {{n}}/{{max}} | {{agent}} needs more information · question {{n}}/{{max}} |
| ask.hintMulti | Bấm chip để điền vào ô trả lời, rồi bấm Gửi trả lời. | Click a chip to fill the answer box, then click Send answer. |
| ask.answer | Câu trả lời | Answer |
| ask.send | Gửi trả lời | Send answer |
| ask.forward | Nhờ người khác trả lời | Ask someone else to answer |
| ask.forwardReview | Chuyển người khác kiểm | Pass the review to someone else |
| ask.forwardTitle | Nhờ ai trả lời? | Who should answer? |
| ask.forwardHelp | Ai trong công ty cũng được, không cần ở phòng này. | Anyone in your company, they don't need to be in this room. |
| ask.search | Tìm người | Find a person |
| ask.note | Lời nhắn (tuỳ chọn) | Message (optional) |
| ask.submit / cancel | Nhờ trả lời / Huỷ | Ask / Cancel |
| ask.forwarded | Đã nhờ {{to}} (chuyển {{k}}/{{max}}) · bạn vẫn trả lời được, ai trả lời trước thì khoá câu hỏi | Asked {{to}} (forward {{k}}/{{max}}) · you can still answer; the first answer locks the question |
| ask.fromYou | {{from}} nhờ bạn trả lời | {{from}} asked you to answer |
| ask.context | Ngữ cảnh kèm theo | Context |
| ask.onlyThis | Bạn chỉ thấy câu hỏi này. Lượt chạy dùng quyền và quota của {{starter}}. | You only see this question. The run uses {{starter}}'s permissions and quota. |
| ask.locked | Đã nhờ tối đa {{max}} lần | Already forwarded {{max}} times |
| ask.answered | {{who}} đã trả lời · {{time}} | {{who}} answered · {{time}} |
| ask.waitingOn / waitingAny | Đang chờ {{name}} trả lời / Đang chờ người trả lời | Waiting for {{name}} to answer / Waiting for someone to answer |
| ask.toast.forwarded / answered | Đã nhờ {{to}} trả lời / Đã gửi câu trả lời | Asked {{to}} to answer / Answer sent |
| ask.err.target | Người này không thể nhận (không hoạt động, khác công ty, là bạn hoặc đã được nhờ). | This person can't receive it (inactive, other company, you, or already asked). |
| ask.err.limit | Đã nhờ tối đa {{max}} lần. | Already forwarded the maximum of {{max}} times. |
| ask.err.group | Chỉ chuyển được cho người cùng nhóm kiểm. | You can only pass it to someone in the reviewing group. |
| ask.err.closed | Đã có người trả lời. | Someone has already answered. |

## 6. `inbox`, `usage` — sidebar, DM, trang lượt chạy, token
| Khoá | VI | EN |
|---|---|---|
| inbox.todo.title | Chờ tôi kiểm | Waiting for me |
| inbox.todo.empty | Không có việc nào chờ bạn | Nothing is waiting for you |
| inbox.todo.more | Xem thêm | Show more |
| inbox.todo.error | Không tải được việc cần làm. | Couldn't load your to-do list. |
| inbox.todo.badge | {{count}} việc đang chờ | {{count}} items waiting |
| inbox.kind.review / ask / decision | Kiểm / Trả lời / Quyết định | Review / Answer / Decide |
| inbox.dm.subtitle | Tài khoản hệ thống · Hub gửi việc cần bạn xử lý, kể cả khi bạn không ở phòng đó | System account · Hub sends you work to handle, even if you aren't in that room |
| inbox.dm.log | Thông báo quy trình | Process notifications |
| inbox.dm.footer | Đây là kênh thông báo của quy trình, không nhắn trả lời được. Xử lý việc bằng các nút trong thẻ. | This is the process notification channel; you can't reply here. Use the buttons on the cards. |
| inbox.dm.empty | Chưa có thông báo nào | No notifications yet |
| inbox.dm.unread | {{count}} chưa đọc | {{count}} unread |
| inbox.notice.review_requested | Cần bạn kiểm: {{process}} · {{stage}} | Needs your review: {{process}} · {{stage}} |
| inbox.notice.ask_requested | Cần bạn trả lời: {{process}} · {{stage}} | Needs your answer: {{process}} · {{stage}} |
| inbox.notice.decision_requested | Cần bạn quyết định: {{process}} | Needs your decision: {{process}} |
| inbox.notice.reminder | Nhắc: việc ở {{process}} vẫn đang chờ bạn | Reminder: your item in {{process}} is still waiting |
| inbox.notice.task_closed | Việc ở {{process}} · {{stage}} đã được xử lý | The item in {{process}} · {{stage}} was handled |
| inbox.notice.run_finished | Quy trình {{process}} đã kết thúc | Process {{process}} has finished |
| inbox.notice.expand | Xem & xử lý | View & handle |
| inbox.notice.openRun | Mở trang lượt chạy | Open run page |
| inbox.run.tab.progress / token / log | Tiến độ / Token / Nhật ký | Progress / Token / Log |
| inbox.run.back.room / ai | Quay lại {{name}} / Quay lại Hỏi AI | Back to {{name}} / Back to Ask AI |
| inbox.run.banner | Bạn không ở phòng này. Bạn chỉ xem được phần cần xử lý (kết quả hoặc câu hỏi của việc này), không đọc được tin nhắn khác. Quyền xem gắn với việc này và được ghi nhật ký. | You aren't in this room. You can only see the part you need to handle (this item's output or question), not other messages. Your access is tied to this item and is logged. |
| inbox.run.meta | {{starter}} khởi chạy · {{time}} · giai đoạn {{n}}/{{total}} | Started by {{starter}} · {{time}} · stage {{n}}/{{total}} |
| inbox.run.log.empty | Chưa có hoạt động | No activity yet |
| inbox.run.log.review / ask / decision | {{actor}} kiểm: {{result}} / {{actor}} trả lời / {{actor}} quyết định: {{result}} | {{actor}} reviewed: {{result}} / {{actor}} answered / {{actor}} decided: {{result}} |
| inbox.run.log.forward / cancel / expire | {{actor}} nhờ {{to}} / {{actor}} huỷ lượt chạy / Lượt chạy hết hạn | {{actor}} asked {{to}} / {{actor}} cancelled the run / The run expired |
| usage.title | Token theo giai đoạn | Tokens by stage |
| usage.kpi.total / in / out / cache / calls | Tổng token / Vào / Ra / Cache / Lượt gọi | Total tokens / Input / Output / Cache / Calls |
| usage.col.stage / attempts / asks | Giai đoạn / Lần chạy / Hỏi lại | Stage / Runs / Follow-ups |
| usage.col.role / agent / model / time | Vai / Agent / Model / Thời gian | Role / Agent / Model / Time |
| usage.expand | Xem lượt gọi giai đoạn {{name}} | Show calls of stage {{name}} |
| usage.calls | Lượt gọi giai đoạn {{name}} | Calls of stage {{name}} |
| usage.team | Nhóm: {{mode}} · {{status}} · {{seconds}} s | Team: {{mode}} · {{status}} · {{seconds}} s |
| usage.mode.sequential / lead_plan / parallel_merge | Kịch bản cố định / Trưởng nhóm lập kế hoạch / Song song + gộp | Fixed order / Lead plans / Parallel + merge |
| usage.teamStatus.running / waiting_answer / done | Đang chạy / Chờ trả lời / Xong | Running / Waiting for an answer / Done |
| usage.teamStatus.limit / failed / cancelled | Chạm giới hạn / Lỗi / Đã huỷ | Limit reached / Failed / Cancelled |
| usage.role.plan / member / agent | Kế hoạch / Thành viên / Agent | Plan / Member / Agent |
| usage.empty | Chưa có lượt gọi nào | No calls yet |
| usage.summary | Bạn chỉ xem tổng theo giai đoạn. | You only see totals per stage. |
| usage.footnote | Chỉ đếm token (từ nhật ký sử dụng). Quy ra tiền khi có quota (H3c). | Tokens only (from the usage log). Cost conversion comes with quota (H3c). |

## 7. Validate client và lỗi API (nguyên văn)
| Ô / mã | VI | EN |
|---|---|---|
| Góp ý trống · `FEEDBACK_REQUIRED` | Nhập góp ý trước khi gửi. | Enter feedback before sending. |
| Quá dài (góp ý, trả lời, ghi chú, lời nhắn) | Tối đa {{max}} ký tự. | At most {{max}} characters. |
| Trả lời trống | Nhập câu trả lời. | Enter an answer. |
| `REVIEW_TASK_CLOSED` | Đã có người khác xử lý việc này. | Someone else already handled this item. |
| `TASK_KIND_MISMATCH` | Thao tác này không áp dụng cho việc này. Tải lại trang. | This action doesn't apply to this item. Reload the page. |
| `PROCESS_RUN_STATE` | Lượt chạy đã đổi trạng thái. Đã tải lại. | The run's state changed. Reloaded. |
| `NO_OUTPUT` | Chưa có bản kết quả nào để dùng. | There is no output version to use yet. |
| `NOT_PROCESS_DECIDER` | Bạn không có quyền quyết định lượt chạy này. | You aren't allowed to decide this run. |
| `PROCESS_NOT_FOUND` (admin Chạy) | Không tìm thấy quy trình hoặc bạn không được chạy. | Process not found or you can't run it. |
| `TOO_MANY_PROCESS_RUNS` (admin Chạy) | Công ty đang chạy tối đa {{max}} quy trình. Thử lại sau. | Your company is running the maximum of {{max}} processes. Try again later. |
| Admin: tên trống | Nhập tên quy trình. | Enter a process name. |
| Admin: ký hiệu sai | Ký hiệu 2–32 ký tự: chữ thường, số, dấu gạch ngang. | 2–32 characters: lowercase letters, digits, hyphens. |
| Admin: `PROCESS_KEY_TAKEN` | Ký hiệu này đã được dùng. | This key is already used. |
| Admin: mã giai đoạn trùng | Mã giai đoạn bị trùng. | Duplicate stage key. |
| Admin: tên tệp sai | Tên tệp dạng ten-tep.md (chữ thường, số, . _ -). | File name like file-name.md (lowercase, digits, . _ -). |
| Admin: mẫu trống | Nhập mẫu kết quả. | Enter an output template. |
| Admin: thiếu mục bắt buộc | Cần ít nhất một mục bắt buộc. | At least one required section is needed. |
| Admin: mã trường sai | Mã trường: chữ thường, số, gạch dưới, bắt đầu bằng chữ. | Field key: lowercase, digits, underscores, starting with a letter. |
| Admin: hành động thật | Hành động thật cần giai đoạn ngay trước có người kiểm. | A real action needs the previous stage to have a reviewer. |
| Admin: bật khi thiếu Group · `PROCESS_DEF_INCOMPLETE` | Chọn Group kiểm cho mọi giai đoạn có người kiểm trước khi bật. | Pick a reviewing group for every reviewed stage before enabling. |
| Admin: hạn | Từ 60 đến 3600 giây. | Between 60 and 3600 seconds. |
| Admin: ngân sách | Từ 1.000 đến 5.000.000 hoặc để trống. | Between 1,000 and 5,000,000, or leave empty. |
| Admin: số giai đoạn | Cần 1–10 giai đoạn. | 1–10 stages are required. |
| Admin: `PROCESS_REF_INVALID` | Agent/nhóm/Group này đã bị tắt hoặc không còn. | This agent/team/group is disabled or gone. |
| Admin: `TEMPLATE_READ_ONLY` | Mẫu chỉ do quản trị nền tảng sửa. Hãy chép mẫu. | Only platform admins edit templates. Copy the template instead. |

## 8. `admin` — Evolu Control
| Khoá | VI | EN |
|---|---|---|
| nav (khoá `nav.processes`, file chung admin) | Quy trình | Processes |
| list.title | Quy trình | Processes |
| list.subtitle | Chuỗi giai đoạn do agent hoặc nhóm agent làm. Người kiểm bấm Đạt thì quy trình tự chạy tiếp, Chưa đạt thì agent làm lại theo góp ý. | A chain of stages done by agents or agent teams. When a reviewer passes a stage the process continues; if it needs rework the agent redoes it using the feedback. |
| list.tab.own / templates | Của công ty / Mẫu | Company / Templates |
| list.create / copy / run | Tạo quy trình / Chép mẫu / Chạy | Create process / Copy template / Run |
| list.col.name / key / stages / running / updated / enabled | Quy trình / Ký hiệu / Giai đoạn / Lượt đang chạy / Cập nhật / Bật | Process / Key / Stages / Running / Updated / On |
| list.filter.all / on / off | Tất cả / Đang bật / Đang tắt | All / On / Off |
| list.empty | Chưa có quy trình. Chép từ tab Mẫu hoặc tạo mới. | No processes yet. Copy one from Templates or create a new one. |
| list.template | Mẫu | Template |
| list.delete.title / body | Xoá quy trình? / Gõ tên “{{name}}” để xoá. Lượt đang chạy vẫn giữ bản cũ. | Delete process? / Type “{{name}}” to delete. Running runs keep their snapshot. |
| list.run.title / input / submit | Chạy quy trình {{name}} / Nội dung đầu vào / Chạy | Run {{name}} / Input / Run |
| list.run.platform | Quản trị nền tảng không chạy được quy trình công ty. | Platform admins can't run a company's process. |
| list.toast.copied / deleted / started | Đã chép mẫu / Đã xoá quy trình / Đã bắt đầu lượt chạy | Template copied / Process deleted / Run started |
| editor.title.new | Quy trình mới | New process |
| editor.tab.config / runs | Cấu hình / Lượt chạy | Configuration / Runs |
| editor.info | Thông tin | Details |
| editor.name / key / desc / hint | Tên quy trình / Ký hiệu chạy / Mô tả / Gợi ý nhập | Process name / Run key / Description / Input hint |
| editor.groups | Group được chạy (để trống = cả công ty) | Groups that can run (empty = whole company) |
| editor.budget | Ngân sách token cả lượt (tuỳ chọn) | Token budget for the whole run (optional) |
| editor.enabled | Bật | Enabled |
| editor.stages / add / remove / up / down | Giai đoạn / Thêm giai đoạn / Xoá giai đoạn / Lên / Xuống | Stages / Add stage / Remove stage / Move up / Move down |
| editor.stage.aria | Giai đoạn {{n}}: {{name}} | Stage {{n}}: {{name}} |
| editor.stage.name / key | Tên giai đoạn / Mã giai đoạn | Stage name / Stage key |
| editor.stage.executor / kind.agent / kind.team | Làm bởi / Agent / Nhóm agent | Done by / Agent / Agent team |
| editor.stage.instruction | Hướng dẫn | Instructions |
| editor.stage.filename / template / sections | Tên tệp kết quả / Mẫu kết quả / Mục bắt buộc | Output file name / Output template / Required sections |
| editor.stage.fields | Trường có cấu trúc | Structured fields |
| editor.stage.after / review / auto / group | Sau giai đoạn / Duyệt bởi Group / Tự chạy tiếp / Nhóm kiểm | After the stage / Reviewed by a group / Continue automatically / Reviewing group |
| editor.stage.real / realLocked | Hành động thật / Cần giai đoạn trước có người kiểm | Real action / Needs the previous stage to have a reviewer |
| editor.stage.answerer / starter / group / user | Người trả lời / Người bắt đầu / Group / Người dùng | Answerer / The starter / Group / User |
| editor.stage.timeout / budget | Hạn giai đoạn (giây) / Ngân sách token giai đoạn | Stage time limit (seconds) / Stage token budget |
| editor.limits | Giới hạn của một lượt chạy | Run limits |
| editor.limitsText | Tối đa 7 ngày · 5 lượt cùng lúc · làm lại ≤ 3 lần mỗi giai đoạn · nhắc người kiểm sau 1 ngày. Chạm giới hạn → “Cần người quyết”. | Up to 7 days · 5 runs at once · at most 3 reworks per stage · reviewer reminder after 1 day. Hitting a limit → “Needs a decision”. |
| editor.readonly | Đây là quy trình mẫu, chỉ xem. Chép mẫu để chỉnh sửa. | This is a template (read-only). Copy it to edit. |
| editor.runs.empty | Chưa có lượt chạy nào | No runs yet |
| editor.runs.col.run / starter / status / stage / started | Lượt / Người bắt đầu / Trạng thái / Giai đoạn / Bắt đầu | Run / Started by / Status / Stage / Started |
| run.title | Lượt chạy · {{name}} | Run · {{name}} |
| run.viewOutput / outputTitle | Xem kết quả / Kết quả giai đoạn {{stage}} · v{{n}} | View output / Stage {{stage}} output · v{{n}} |
| run.noContent | Không xem nội dung tin nhắn phòng ở đây. | Room messages aren't shown here. |
