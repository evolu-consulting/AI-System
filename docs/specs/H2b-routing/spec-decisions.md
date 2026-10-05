# H2b — Quyết định

## Trước SPEC — người dùng đã chốt (không hỏi lại)
| # | Quyết định | Áp vào |
|---|---|---|
| U1 | Orchestrator route **mọi** tin (kể cả trong flow, kể cả trả lời `ask` của run `direct`) | R08, R12 |
| U2 | User biết agent thì tag `@agent` để gọi thẳng, bỏ qua Orchestrator | R06 |
| U3 | Orchestrator theo tenant = bản mặc định + bản riêng per tenant | R13–R15 |
| U4 | Quyền command và quyền agent độc lập (HUB-BR-19) | R02, R11 (AU không xét feature) |
| U5 | Mặc định review business #2–#8 (CR-034) đã đồng ý: `max_concurrent_runs` = 2, xác nhận `side_effect` | R16, R12 |
| U6 | Contract `chat`: sửa thẳng `packages/contracts/src/chat`, **chỉ thêm**; không sửa `apps/chat-web`, `tests/contract/chat`, `tests/acceptance/C1`; thay đổi làm đỏ chúng → nêu, không làm | §3 |
| U7 | Codex/Gemini → H2d; không ghi ý tưởng "Agent Builder" | §1 |

## Câu hỏi cho người dùng
Chỉ một câu cần người dùng chọn. Không trả lời → dùng mặc định.

### Q1 · Tên agent khi user tự tag `@agent` lấy từ đâu? (mức Cao — chạm contract chat)
BA (CR-033): user tự tag thì câu trả lời hiện **tên hiển thị của agent**; Orchestrator tự chọn thì vẫn "Consultant". ROADMAP H2b ghi contract chat "chỉ thêm `GET /agents` + mã lỗi" — chưa tính trường nào mang tên agent. Contract C1 hiện cấm khoá `agent` ở SSE/E10/E11/E14 (test khoá `FORBIDDEN_KEYS`).

| Lựa chọn | Nội dung | Hệ quả |
|---|---|---|
| **B (đề xuất)** | Hub gửi trường **tuỳ chọn** `responder: {key, name}` trong `run.started` và message assistant (E11, preview E10), **chỉ** với run `direct`. Khoá tên `responder` (không phải `agent`) | Nguồn chân lý ở Hub (đã xử lý `@@`, nhiều tag, tag sai, đổi quyền, đổi tên — tên chốt lúc tạo run). Vẫn "chỉ thêm"; test khoá C1 không đỏ (trường vắng ở tin không tag; `FORBIDDEN_KEYS` so đúng khoá `agent`). Vượt câu chữ "chỉ `GET /agents` + mã lỗi" của ROADMAP → ROADMAP sửa theo. Chat hiển thị khi combine |
| A | Không thêm trường: Chat tự suy ra từ tin user (`@key` đầu tin) + `GET /agents` | Contract đúng phạm vi ROADMAP. Chat phải lặp luật Router (R01–R04: `@@`, nhiều tag → "Consultant", tag trùng); lịch sử hiện tên **hiện tại** (agent bị thu hồi khỏi menu → chỉ còn key); tin đã bị Hub từ chối không có run nên không lệch |
| C | Thêm trường `responder` cho **mọi** run có pass-through (cả khi Orchestrator chọn) | Trái BA (Orchestrator chọn vẫn "Consultant", CR-022/CR-033) → cần CR sửa BA; không đề xuất |

**Mặc định đề xuất: B.**

## Mặc định tự chọn (mức Thường — ghi lại, không hỏi)
| # | Câu hỏi | Mặc định đã chọn | Lý do |
|---|---|---|---|
| T1 | Nhiều tag, một tag sai | Cả tin `AGENT_NOT_FOUND` (tag sai đầu tiên) | Nhất quán BR-18 "sai tag không rơi xuống Orchestrator"; không âm thầm bỏ tag |
| T2 | Tag rỗng nội dung (`@hoadon`) | 422 `CMD_MISSING_ARG` `missing:["content"]` | BA HUB-FR-91 ghi đúng mã này; dùng lại schema `details` H2a |
| T3 | `partial` ở run `direct` (không có Orchestrator) | `text` + câu tĩnh "Phần chưa làm được: …" | BR-04 không giấu phần thiếu; không gọi Orchestrator (U2) |
| T4 | Trả lời xác nhận khi có tag | So "Đồng ý" trên nội dung sau tag; chỉ tag đơn đúng agent đang chờ mới `confirmed` | Tránh "@trello Đồng ý" bị `declined` vì so cả chuỗi; tag agent khác không được mượn xác nhận |
| T5 | Agent là Orchestrator của tenant khác có vào menu/tag/delegate? | Không, ở mọi phạm vi | Đơn giản, đúng "agent Orchestrator không nằm trong danh sách delegate"; tránh agent điều phối chạy CLI không tool như agent thường |
| T6 | Xoá bản Orchestrator riêng khi seed là nguồn duy nhất (H1-R16 không xoá) | `{tenant_key, remove: true}` tường minh | Giữ luật "không xoá thứ không có trong yaml" (H4 Studio sẽ ghi cùng bảng) |
| T7 | Bản riêng mất hiệu lực lúc chạy (agent bị tắt sau seed) | Dùng mặc định + log cảnh báo | Không chặn user; BR-08 chỉ bắt buộc bản mặc định |
| T8 | Nguồn `max_concurrent_runs` | env `HUB_MAX_CONCURRENT_RUNS` (mặc định 2), toàn hệ thống | BA "cấu hình Hub"; theo tenant/user để H3/H4 nếu cần |
| T9 | Run nào tính vào giới hạn | Mọi `kind` đang `running` (cả lệnh async) | BA "số run running"; lệnh async dài vẫn chiếm tài nguyên |
| T10 | `Retry-After` | 5 giây cố định | Run ngắn nhất ~ vài giây; client chỉ cần gợi ý |
| T11 | Thứ tự lỗi E12 | Router (`CMD_*`/`AGENT_NOT_FOUND`) → `FLOW_BUSY` → `TOO_MANY_RUNS` | Lỗi sửa được bằng gõ lại báo trước; không mở transaction cho tin sai. BA §5 đặt 429 trước Router — lệch chữ, ghi CR-037 |
| T12 | Cách stream khi kết quả có cấu trúc | Runtime chỉ phát khi `decision`/`status` đứng trước `text`; Hub lọc theo vai job; lệch/JSON hỏng sau khi phát → giữ chữ đã phát | Bất biến C1 "content = nối delta" không cho rút lại chữ đã gửi; lùi về H1 khi không chắc |
| T13 | Độ dài `delta` khi stream | Hub vẫn cắt ≤ 40 ký tự | Giữ test khoá H1 A15, H2a A17/A31 |
| T14 | F4 mã lỗi | Không thêm mã `run.failed` mới (đổi enum C1); phân loại vào mã có sẵn + `hint` riêng, reason nội bộ `refused` | Không chạm `CHAT_RUN_ERROR_CODES` |
| T15 | F5 khi chưa có usage | Không ghi dòng | WRK-FR-17 + "không bịa"; tránh dòng 0 token đếm sai lượt ở báo cáo M4 |
| T16 | F7 | `HUB_LIVE=1` thành cờ bộ smoke tự động (skip khi vắng) | Cần smoke stream thật cho R20 (K1); không chặn `done:h2b` |
| T17 | Agent `dify-*` có stream khi gọi thẳng/pass-through? | Có (R24) | Kết quả luôn `done` nên an toàn; code đọc SSE Dify đã có (H2a) |
| T18 | Nợ H2a đưa vào H2b | #44 (tách thư mục con module chạm tới), #47 (`fake-cli` delegate lại) | #47 làm sai test R12; #44 vì module `runner`/`commands` sẽ thêm file. #43, #45, #46, #49–#51 để sau |

## CR
- **CR-037** (đề xuất, chờ Gate H2b): sửa chữ BA cho khớp spec — thuật ngữ Run có 3 loại; thứ tự kiểm 429 sau Router (T11); agent là Orchestrator ở mọi phạm vi không delegate/tag được (T5); WRK-FR-03 chi tiết `delta` chỉ cho job có thể là câu trả lời cuối, Hub cắt ≤ 40 (T12, T13); HUB-FR-62 xoá bản tenant qua seed `remove` (T6). Áp vào design sau Gate (docs-architect).
- CR-impact Chat/Admin của H2b (menu `@`, `AGENT_NOT_FOUND`, `TOO_MANY_RUNS` + `Retry-After`, `responder` nếu Q1=B, `delta` đến khi step còn mở) ghi ở I3 như CR-036.
