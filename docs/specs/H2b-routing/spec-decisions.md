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

## Trả lời người dùng (2026-10-05)
| # | Trả lời | Áp vào |
|---|---|---|
| Q1 | **B** — Hub gửi trường **tuỳ chọn** `responder: {key, name}` trong `run.started` và trong tin trả lời (E11, preview E10), **chỉ** với run gọi thẳng (`kind=direct`); contract chat **chỉ thêm** (không đổi/xoá trường, không sự kiện SSE mới, khoá `agent` vẫn cấm). `name` = tên agent theo `locale` của run, chốt lúc tạo run (`runs.responder_key`/`responder_name`) | spec R10, §3, §4; plan P1–P2 |

## Câu hỏi cho người dùng (đã trả lời — giữ để truy vết)
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

## Gate duyệt — 2026-10-05
- Người dùng duyệt Gate H2b ("Oke"): CR-037 (sửa chữ BA), Q1 = B, contract chat chỉ thêm, F4 giữ mã H1 + `refused`, `maxConcurrentRuns` vắng = không giới hạn (server luôn điền từ env, mặc định 2).

## BUILD — C1/C2
| # | Task | Quyết định tự chọn | Lý do |
|---|---|---|---|
| BC1 | C1 | `AGENT_KEY_PATTERN` chép vào `src/common.ts` (cùng tên, cùng regex với `hub/common`); chat dùng `ChatAgentKeySchema` (tên riêng, ở `chat/agents.ts`) | plan §2.1 cấm import `../hub`; tên riêng tránh trùng `AgentKeySchema` của hub khi một file import cả hai subpath |
| BC2 | C1 | `ResponderSchema` + `RESPONDER_NAME_MAX` đặt ở `entities.ts` (theo plan), `entities` import key từ `./agents` — `agents.ts` chỉ phụ thuộc `../common` (không vòng) | Đúng bảng plan §2.1 |
| BC3 | C1 | Thêm hằng `AGENT_SUGGESTIONS_MAX = 3`, `AGENT_MENU_NAME_MAX`, `AGENT_MENU_DESC_MIN/MAX` (plan chỉ ghi số) | Không rải số ma thuật; BE/FE dùng chung |
| BC4 | C1 | Test mới ở `chat/agents.test.ts` (không sửa `entities.test.ts`) | Giữ `entities.test.ts:142` nguyên văn |
| BC5 | C2 | Fixture `JobPayload.stream-string.json` dùng `"stream": "always"` (không `"true"`) | pydantic chế độ lax ép `"true"` → `True` ⇒ mẫu invalid lọt (`test_contracts_hub.py` đỏ); chuỗi không ép được giữ đúng ý "stream là chuỗi" |
| BC6 | C2 | **Phát hiện:** zod 4.6.5 `z.string().max()` đếm **code point** (đo: 4 000 emoji hợp lệ, 4 001 bị từ chối), pydantic `max_length` cũng đếm code point — plan §2.2/`rt` §9 H3 ghi "zod đếm UTF-16" là sai. Không đổi schema: Runtime cắt theo UTF-16 (`split_utf16`) luôn ≤ 4 000 code point ⇒ vẫn hợp lệ ở cả hai phía (an toàn, chỉ bảo thủ hơn). Sửa chú thích `JOB_DELTA_TEXT_MAX`; test `hub/delta.test.ts` khoá đúng hành vi đo được | Không chặn; PY-01/QW-PU giữ `split_utf16` được. Áp tương tự cho mọi "cắt UTF-16" phía Hub (responder, delta 40) — chỉ bảo thủ hơn |
| BC7 | C2 | `apps/hub-api` typecheck xanh không cần sửa (union `RunEvent` mới không làm đỏ — chưa có `switch` vét cạn theo `type`); pyright Runtime 0 lỗi với `RunEvent5` sinh | Ghi lại theo yêu cầu (H2a C2 từng phải sửa) |

## BUILD — MK/F3
- **MK-1** `done:h2b` (`tools/scripts/src/done-h2b.ts`) dựng từ `h2aSteps()` (16 bước test-plan §7.1): unit/int/perf nối thêm `H2b`, chèn `test:h2b:stack` sau `test:h2a:stack`, H01 sau contract chat. Cơ chế chạy tách thành `runDone(name, steps, argv)` trong `done-h2a.ts` (không đổi hành vi `done:h2a`). Python dùng lại `pythonCommand` (env DB `export` trong chuỗi lệnh `scripts/run.ts`, bài học H2a); typecheck `--filter=@ai/scripts`.
- **MK-2** (lệch chữ test-plan §7.1 bước 10): Bun áp `pathIgnorePatterns` **cả khi truyền đường dẫn tường minh** (thử tay) ⇒ `bun --env-file=.env.local test tests/acceptance/H2b/hubdev` với `bunfig.toml` (đã bỏ `H2b/hubdev/**`, L6) sẽ không chạy file nào. Thêm `bunfig.stack.toml` (chỉ bỏ `e2e`, `node_modules`, `__fixtures__`); bước H01 và `test:h2b:stack` chạy `--config=bunfig.stack.toml`, timeout 120 s.
- **MK-3** `test:h2b:stack` = `HUB_MAX_CONCURRENT_RUNS=2 bun … tests/acceptance/H2b/stack` (tường minh, L6). `tools/hub-dev` `hubApiEnv()`: hub-api dev nhận `HUB_MAX_CONCURRENT_RUNS` từ env, vắng ⇒ **20** (plan §2.1, K4b) — đặt sẵn để contract 41 ca không chạm 429 khi B5 cài giới hạn. hub-api `:4000` chạy sẵn thì dùng lại, không áp được giá trị này.
- **MK-4** `test:smoke:live` = `tools/scripts/src/smoke-live.ts`: vắng `HUB_LIVE` (hoặc `0`) → in "bỏ qua", exit 0 kể cả khi `tests/smoke` chưa có file; có cờ → `bun --config=bunfig.stack.toml test --timeout 300000 tests/smoke`. `tests/smoke/**` thêm vào ignore của `bunfig.toml` + `bunfig.int.toml` để `bun test`/`test:int` không vô tình gọi CLI thật.
- **F3-1** `tools/hub-dev/src/fixture.ts`: `BETA_TESTERS = { acme: ["lan"] }` → sau khi tạo user, `ensureContractFixture` tra group `beta-testers` của tenant (`GET /admin/groups?q=`) và `POST /admin/groups/:id/members {usernames}` (idempotent: đã có → `already`; `not_found` ⇒ ném lỗi). `hoa` giữ ngoài (R26). Chạy lại fixture hai lần: OK, DB `acme|lan`.
- **F3-2** Chạy `bun run test:contract:chat` với Hub thật (`hub:dev`, Runtime container `fake-cli`) trong **worktree sạch tại HEAD `50b5ad7`** (+ fixture mới) — vì cây làm việc đang có D1/C2 dở (`0006_h2b_routing.sql`, `schema/hub.ts`), `hub:dev` sẽ `db:migrate` bản dở vào DB dev. Kết quả: **41 pass, 0 fail** (62 ca, phần còn lại skip như H2a). Không sửa test khoá C1.
- **F3-3** Chưa thể đỏ do 429: giới hạn `TOO_MANY_RUNS` (B5) chưa cài. `hub:dev` đã đặt sẵn `HUB_MAX_CONCURRENT_RUNS=20` (MK-3). **Chạy lại ở I1** (bước 9 `done:h2b`) sau B5 để xác nhận K4b.
