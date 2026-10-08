# Test plan e2e · X2b-room-agents (qc, chế độ WRITE — chưa LOCK)

Nguồn: `plan-frontend-e2e.md` (bản `d1e492c`, thread chung Q7 lần 2), `plan-frontend-i18n.md`, spec AC01/02/05/06/08/13/15/16/17. Không sửa `test-plan.md` / `tests/acceptance/X2b/**`. `tests/.lock` chưa ghi.

## 1. Hạ tầng
| Thứ | Nội dung |
|---|---|
| Config | `e2e/chat/playwright.x2b.config.ts` (`testMatch **/*.x2b.ts`, `locale vi-VN`, 1 worker). Cổng mặc định api 3032 · hub 4051 · rt 4058 · web 3131; đổi bằng `CHAT_E2E_{API,HUB,READY,WEB}_PORT`. Redis DB 13 |
| Stack | `_x2b-stack.ts` = `_x2a-stack` (reset DB, migrate, `hub:seed`, admin-api, hub-api thật, `HUB_MAX_CONCURRENT_RUNS=2`) + fixture SQL: agent `hoadon` (tên hiển thị = key), `trello` ("Trello"), entitlement acme, grant A=`lan` (hoadon, trello) · B=`thu` (trello) · C=`an` (hoadon) |
| Runtime giả | `_x2b-runtime.ts` chạy trong tiến trình stack: claim `hub.jobs` bằng SQL owner + XADD `run:<id>` (như `H1/_runtime.ts`, không `bun:test`); test gọi `POST /rt/claim|answer` (cổng rt). Provider `fake-1`/`fake-cli`; không Dify, không `claude-sub` |
| Helper | `_x2b-support.ts` (3 context A/B/C, `invokeUi` đòi `X-Run-Id`, `sendFlow`, `pendConfirm`, `setGrant`, `postRaw`); dùng lại `_x2a-support.ts` |
| Chạy | `bunx playwright test -c e2e/chat/playwright.x2b.config.ts --reporter=line --output=<riêng>` (tuần tự với bộ e2e khác dùng DB test) |

## 2. Ca
Nhãn nguyên văn `plan-frontend-e2e.md` §1. "Khối" = `article "Trả lời của agent hoadon"`; "khung" = `complementary "Flow đang mở"`; composer phòng `textbox "Tin nhắn cho nhóm"`; composer thread `textbox "Tin nhắn trong flow"` + `button "Gửi trong flow"`.
| Ca | File | AC | Locator chính | Dữ liệu | Kỳ vọng | Đỏ đúng lý do (trước code UI/BE) |
|---|---|---|---|---|---|---|
| E-A1 | x2b-room | AC13 | `listbox "Agent"`, `option` chứa `@hoadon`/`@trello`, chữ "Agent bạn dùng được", `complementary` | phòng A+B+C | A 2 option; chọn ⇒ ô = `@hoadon `; B 1 option (`@trello`); không `complementary` | `expect(listbox).toBeVisible` (menu `@` phòng chưa có) |
| E-A2 | ″ | AC13 | `listbox "Agent"`, "Bạn chưa được cấp agent nào" | SQL xoá grant `trello` của B + bump version (khôi phục ở `finally`) | sau Hub poll (`GET /agents` B rỗng) và mở lại phòng: 0 option | `toHaveCount(1)` đầu ca (menu chưa có); phần thu hồi dựng xong (poll xanh không đạt tới) |
| E-A3 | ″ | AC01, AC16 | `button "Dừng"` (A), `status` "hoadon đang xử lý…" + "Chỉ Lan Tran dừng được" (B), khối "Lan Tran hỏi"/"Bạn hỏi"/"Chạy bằng quyền của Lan Tran", `unread-badge` | A `@hoadon kiểm tra`; rt trả "HD-12 hợp lệ."; lượt 2 khi B ở `/c/new` | A Dừng, B không Dừng; xong cả hai thấy khối; badge B = "2" (tin gọi + khối agent, đúng `realtime` unread +2), A không badge | `X-Run-Id` null (tin `@` hiện là tin thường) |
| E-A4 | ″ | AC02 | `alert` "Không tìm thấy agent @hoadon.", `textbox` value | B `@hoadon kiểm tra chui` | không run; alert; ô giữ chữ; timeline A/B không có tin; không "đang xử lý…" | `expect(alert).toBeVisible` (X2b chưa 404 — tin vẫn gửi) |
| E-A5 | ″ | AC05 | `region /hoadon cần thêm thông tin/`, `button "HD-12"`, chữ "Đang chờ Lan Tran trả lời agent." | rt `need_input` "Số hoá đơn nào?" [HD-12, HD-13] | A chip ⇒ request `{answer_run_id=runId, flow_id}` + tin trong khung; B thấy câu hỏi, không region/chip | `X-Run-Id` null |
| E-A6 | ″ | AC06 | `region /hoadon cần bạn xác nhận/`, `button "Đồng ý"/"Huỷ"`, `article "Agent hoadon đang chờ xác nhận"` | `tool_confirmations` pending + rt "Xác nhận tạo thẻ PARAM-SECRET-77…?" | A thấy Đồng ý/Huỷ; B chỉ "Đang chờ Lan Tran xác nhận — chỉ người hỏi mới bấm được.", không Đồng ý, `content()` không chứa `PARAM-SECRET-77` | `X-Run-Id` null |
| E-A7 | ″ | AC15 | `button "Trả lời tiếp"`, URL `?flow=`, `complementary`, `dialog "Flow đang mở"` @390px, `button "Đóng khung flow"` | A gọi + xong; gửi "Còn hoá đơn HD-13 thì sao?" | URL có `flow`; gửi trong flow thấy tin; 390px ⇒ dialog. `/c/:id` C1 không đổi: bộ `e2e:chat` C1 (không lặp ở đây) | `X-Run-Id` null |
| E-A8 | ″ | AC08 | `alert /quá nhiều câu trả lời đang chạy/` + "Thử lại sau N giây", value ô | A 2 run chưa xong + run 3; B `@trello` | A: 429 ⇒ alert, ô giữ chữ; B có `X-Run-Id`, không alert | `X-Run-Id` null (run 1 của A) |
| E-A9 | x2b-thread | AC17 | khung (A, C mở), `button "Dừng"` (C), `status` "hoadon đang xử lý…" (A), khối "An Nguyen hỏi"/"Chạy bằng quyền của An Nguyen" | A gọi, xong; C `@hoadon kiểm tra tiếp…` trong `textbox "Tin nhắn trong flow"`; SQL `usage_logs`; A và C tag song song | C Dừng, A không Dừng; A thấy đang xử lý rồi khối của C; usage: C > 0, A = 0 (run C); song song ⇒ `working` count 2 | `X-Run-Id` null ở bước dựng gốc (`seedThread`) |
| E-A10 | ″ | AC17 | khung/`textbox` của B, `alert` "Không tìm thấy agent @hoadon.", API `NOT_FOUND` | B ok nhé (không tag); B `@hoadon kiểm tra giúp`; `flow_id` lạ; `flow_id` của phòng khác | A, B, C thấy tin B; `hub.runs` không tăng; tag ⇒ alert, giữ chữ, A không thấy; API 404 `NOT_FOUND` ×2 | như E-A9 (`seedThread`) |
| E-A11 | ″ | AC17, AC06 | `region /hoadon cần bạn xác nhận/` (C), `article "Agent hoadon đang chờ xác nhận"` (A, B), `postRaw` | lượt C `side_effect` PARAM-SECRET-77; A `postRaw {flow_id, answer_run_id=runC}` | C Đồng ý/Huỷ, bấm ⇒ request `{flow_id, answer_run_id=runC}`; A, B "Đang chờ An Nguyen xác nhận…", không lộ tham số, A nhắn thường được; A forge ⇒ 403 `NOT_RUN_CALLER` | như E-A9 |

## 3. Kết quả chạy (2026-10-08, code trước F1/B*; DB `ai_system_test`, cổng 3042/4061/4068/3141, `--output=test-results-x2b-qc`)
| Tổng | Đỏ đúng lý do | Đỏ ở dựng stack/seed | Xanh |
|---|---|---|---|
| 11 | 11 | 0 | 0 |

Stack dựng được (admin-api, hub-api, chat-web, Runtime giả); mọi ca đỏ ở `expect`: menu `@` phòng chưa có (E-A1, E-A2), tin `@` chưa trả `X-Run-Id` (E-A3, 5–11), chưa 404 `AGENT_NOT_FOUND` cho tag của B (E-A4). Các ca sau bước dựng gốc (`seedThread`/`invokeUi`) mới chỉ chứng minh đỏ ở bước đầu: phần sau (khối, chờ, thread, 403) **chưa được thực thi** — khi BE B3+ xong, chạy lại và rà đỏ/xanh từng đoạn. Không `typecheck` riêng cho e2e (ngoài `tsc` gốc). Server mồ côi: đã kiểm, không còn LISTEN trên 4 cổng.

## 4. Ghi chú / mơ hồ / cần bổ sung
- Tên agent hiển thị = key ("hoadon") theo ví dụ plan ("hoadon đang xử lý…", option "hoadon"); nếu seed dev (B7) đặt tên "Hoá đơn" thì chỉ cần đổi fixture stack (`name`) — locator dùng chung hằng `agent` ở `_x2b-support.ts`.
- Huy hiệu E-A3: plan ghi "+1"; test đòi "2" (tin gọi + khối agent, khớp `test-plan.md` §5 realtime "unread B +2"). Cần frontend-lead/qc xác nhận.
- E-A10: plan nêu gợi ý "Ý bạn là" — test **không** khẳng định (B chỉ có `trello`, không chắc BE trả `suggestions`).
- E-A9: khối của C hiển thị trong khung thread (tin `placement=flow`); test đọc ở khung của A (A mở thread), không ở timeline chính.
- Gửi trong khung flow dùng `Gửi trong flow` (tag/không tag cùng một composer, D13).
- **Cần bổ sung (backend-lead B7):** seed dev có C có `hoadon` (stack e2e tự seed nên không chặn); xác nhận tên hiển thị agent và vị trí header `X-Run-Id` qua proxy chat-web (Playwright đọc `x-run-id` từ response của trình duyệt).
- `package.json`/`tools/scripts` không thuộc qc: đề xuất script `"e2e:chat:x2b": "bunx playwright test -c e2e/chat/playwright.x2b.config.ts"` (frontend-lead/điều phối).
