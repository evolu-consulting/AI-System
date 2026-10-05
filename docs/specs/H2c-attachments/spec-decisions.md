# H2c — Quyết định

## Trước SPEC — người dùng đã chốt (không hỏi lại)
| # | Quyết định | Áp vào |
|---|---|---|
| U1 | (2026-10-05) File lưu trên **ổ đĩa của Hub** (thư mục cấu hình, **tách theo tenant**) sau một **interface Storage**; driver `local` bây giờ, S3 là driver khác làm sau. Chốt câu hỏi mở 2 BA-H | R04, CR-039 |
| U2 | (2026-10-05) **Runtime tải file qua endpoint nội bộ của Hub bằng token job** (như `POST /internal/jobs/:id/dify-credential` H2a) để Runtime ở máy khác vẫn chạy; không thư viện/hạ tầng mới | R16, R17, R25 |
| U3 | Contract `chat`: sửa thẳng `packages/contracts/src/chat`, **chỉ thêm**; không sửa `apps/chat-web`, test khoá C1; thay đổi làm đỏ chúng → nêu, không làm | §3, R12, R30 |
| U4 | Orchestrator route mọi tin; `@agent` gọi thẳng (H2b); sandbox H1 (realpath, chặn ngoài `work/<job_id>`); token job H2a (chỉ hash trong DB); xác nhận `side_effect` H2a | R10, R15–R18, R23 |
| U5 | Không ghi ý tưởng "Agent Builder" | — |

## Câu hỏi cho người dùng
Ba câu cần người dùng chọn. Không trả lời → dùng mặc định (đề xuất).

### Q1 · User được đính kèm loại file nào? (mức Cao — bảo mật, chạm contract chat)
BA chỉ nêu ví dụ "PDF, ảnh, XML" (US-H07). Hub không quét virus ở H2c; file đi tới agent CLI và Dify.

| Lựa chọn | Nội dung | Hệ quả |
|---|---|---|
| **A (đề xuất)** | Danh sách cho phép: `pdf`, `png`, `jpg`/`jpeg`, `gif`, `webp`, `docx`, `xlsx`, `pptx`, `txt`, `md`, `csv`, `xml`, `json`; kiểm chữ ký nội dung (R03) | Đủ cho hoá đơn/báo cáo/ảnh chụp; Claude Code đọc trực tiếp PDF/ảnh/chữ; Dify nhận cả nhóm này. Không có `html`/`svg` (chạy script khi mở), `zip`, file Office cũ (`doc`/`xls`), âm thanh/video. Thêm loại sau = sửa một hằng + test |
| B | A + `html`, `svg`, `zip`, `doc`, `xls`, `ppt` | Rộng hơn; `html`/`svg` chỉ an toàn nhờ header tải về (R13); `zip` agent không giải nén được (không Bash); Office cũ khó kiểm chữ ký (OLE) |
| C | Mọi loại trừ file thực thi (`MZ`, ELF, `#!`) | Linh hoạt nhất; rủi ro file độc cao nhất khi chưa quét virus; Dify từ chối nhiều loại → nhiều lỗi `UPSTREAM_ERROR` |

**Mặc định: A.**

### Q2 · File đã gửi kèm giữ bao lâu? (mức Cao — lưu trữ dữ liệu khách hàng)
| Lựa chọn | Nội dung | Hệ quả |
|---|---|---|
| **A (đề xuất)** | Giữ theo hội thoại: còn hội thoại còn file; user xoá hội thoại → nội dung file bị xoá ≤ 10 phút (hàng metadata giữ, `available=false`) | Agent ở lượt sau trong flow vẫn đọc được file cũ; dung lượng chỉ giới hạn bằng hạn mức tenant (5 GiB, R06) |
| B | A + hạn cố định N ngày kể từ lúc tải (đề xuất N = 30, env `HUB_ATTACH_RETENTION_DAYS`) — quá hạn xoá nội dung dù hội thoại còn | Ổ đĩa tự giải phóng; hội thoại cũ hiện "file đã hết hạn", agent không còn thấy file đó |
| C | Giữ đến khi tenant cấu hình chính sách (H3), H2c không xoá file đã gắn | Đơn giản nhất; ổ Hub chỉ tăng; xoá hội thoại không xoá file (lệch kỳ vọng riêng tư) |

**Mặc định: A.** File **chưa gắn** vào tin luôn bị xoá sau 24 h (T4) — không phụ thuộc câu này.

### Q3 · Làm `out/` (agent trả file cho user, WRK-FR-18 COULD) ngay ở H2c?
| Lựa chọn | Nội dung | Hệ quả |
|---|---|---|
| **A (đề xuất)** | Làm ở H2c (R24–R26): ≤ 5 file/job, cùng luật loại/kích thước/hạn mức như upload | Thêm 1 endpoint nội bộ + phần Python liệt kê/tải lên; dùng lại toàn bộ luật R02/R03/R06, `GET /attachments/:id/content`. Ước ~15% khối lượng mốc |
| B | Hoãn sang mốc sau (gợi ý H2d) | H2c gọn hơn; agent chỉ trả chữ; R24–R26, AC-12 bỏ khỏi `done:h2c` |

**Mặc định: A.**

## Mặc định tự chọn (mức Thường — ghi lại, không hỏi)
| # | Câu hỏi | Mặc định đã chọn | Lý do |
|---|---|---|---|
| T1 | Multipart hay thân thô? | Thân thô + header `X-Filename` (percent-encode), stream thẳng ra đĩa | Hono/Bun `formData()` đệm cả file trong RAM; tự viết bộ phân tích multipart dạng stream là rủi ro; trình duyệt/extension gửi `File` làm `body` dễ. Dify upload phía Hub vẫn dùng multipart (FormData + `Bun.file`) |
| T2 | "20 MB" là MB hay MiB? | 20 MiB = 20 971 520 B; `Content-Length` vượt → 413 trước khi đọc; thêm `bodyLimit` (`hono/body-limit`, đã dùng ở admin-api) cho thân chunked | Không thư viện mới; khớp cách đếm byte ở mọi nơi |
| T3 | Số file | ≤ 10 file/tin; tập file của run ≤ 10 file và ≤ 100 MiB | Giới hạn thời gian tải ở Runtime và prompt |
| T4 | Xoá file chưa gắn | Tự xoá sau 24 h; **không** có `DELETE /attachments/:id` cho user | Ít endpoint; Chat bỏ chip thì file tự hết hạn |
| T5 | Tin chỉ có file, không chữ? | Không — `content` vẫn bắt buộc (contract C1 `min(1)`) | Giữ C1 nguyên; agent cần biết làm gì với file |
| T6 | Một file gắn nhiều tin? | Không — gắn đúng một lần; dùng lại → 404 `ATTACHMENT_NOT_FOUND` | Vòng đời theo một hội thoại (Q2); lượt sau trong flow vẫn thấy file (R14) |
| T7 | Ai gọi Dify `/files/upload` cho command async? | Hub, trước khi enqueue; Runtime gửi nguyên `inputs` | Một chỗ cài đặt; key Dify không ra khỏi Hub thêm lần nào; Runtime không cần tải file cho `workflow.async` |
| T8 | Cache `upload_file_id` của Dify? | Không — tải mỗi lần gọi | Dify gắn file theo app + `user`; cache dễ sai app/hết hạn |
| T9 | Map `attachment` khi tin có nhiều file? | File đầu tiên theo thứ tự `attachment_ids` | Input `file` của M2 là một file; `file-list` chưa có trong `input_schema` |
| T10 | Tool MCP nhận file thế nào? | Tham số chuỗi = `name` (hoặc `id`) của file trong `attachments/` của job; workflow có input `file` chỉ hiện khi job có file | Model thấy tên trong prompt; Hub kiểm thuộc job → không lấy được file ngoài tin |
| T11 | Agent `dify-workflow`/`dify-agent` (chạy trong Hub) nhận file? | Không ở H2c; Orchestrator vẫn thấy metadata | ROADMAP chỉ nêu command/tool; tránh mở rộng H2a-R14 |
| T12 | Orchestrator có đọc file? | Chỉ metadata (tên, mime, size) trong prompt | Đủ để định tuyến (AC-H03); job Orchestrator không có tool đọc file |
| T13 | Lượt sau trong flow thấy file cũ? | Có — tập file của run = file của mọi tin trong flow, mới nhất trước (R14) | "kiểm hoá đơn" rồi "tạo thẻ cho nó" cần cùng file; flow thuộc đúng một user |
| T14 | Hạn mức dung lượng tenant | Một ngưỡng env chung (5 GiB) → 409; theo từng tenant ở H3 | Bảo vệ ổ Hub ngay; cấu hình tenant thuộc quota H3 |
| T15 | Quét virus/nội dung | Ngoài phạm vi; allowlist + chữ ký (R03) + header tải về an toàn; ghi PRODUCTION-NOTES ở I3 | Không hạ tầng mới (U2) |
| T16 | Mã lỗi mới ở đâu? | Hằng riêng `CHAT_ATTACHMENT_ERRORS` (như `CHAT_ROUTING_ERRORS` H2b); lỗi khi chạy dùng mã `run.failed` có sẵn (`INTERNAL_ERROR`, `UPSTREAM_ERROR`, `NOT_CONFIGURED`) | Test khoá C1 đếm `CHAT_API_ERRORS`/`CHAT_RUN_ERROR_CODES` |
| T17 | Runtime tải file lỗi | Job `failed`, reason mới `attachment`, `run.failed INTERNAL_ERROR` | Không cho agent chạy thiếu file mà user tưởng đã gửi |
| T18 | Lỗi endpoint nội bộ | Mọi sai token/job/id ngoài payload/lệch tenant → 401 một thân; file đã xoá → 404 | Không lộ tồn tại (như H2a dify-credential) |
| T19 | Người dùng tải lại file của mình | Có `GET /attachments/:id` + `/content` (chỉ chủ), luôn `Content-Disposition: attachment` | Cần cho xem lại tin và file `out/` |
| T20 | Audit/usage | Log `attachment_uploaded` (không tên file/nội dung); trace step Dify upload; không `usage_logs` | Không có chi phí model; tính phí lưu trữ (nếu có) → H3 |

## CR
- **CR-039** (đề xuất, áp ở I3 như CR-037): sửa chữ BA cho khớp spec H2c — xem `docs/CHANGE-REQUESTS.md`.

## Ghi chú cho PLAN
- `job-agent-runner.ts` 380 dòng (TD #52) — tách trước khi thêm R15.
- `work/<job_id>/` không được dọn sau job (hiện trạng) → ghi TECH-DEBT (spec K7).
- Mock Dify `tools/hub-dev/src/dify-mock.ts` thêm `/files/upload`; `.gitignore` thêm `.data/`.

## Trả lời người dùng (2026-10-05) — spec chuyển `approved`
| # | Chọn | Áp vào |
|---|---|---|
| Q1 | **A** — danh sách cho phép `pdf`, `png`, `jpg`/`jpeg`, `gif`, `webp`, `docx`, `xlsx`, `pptx`, `txt`, `md`, `csv`, `xml`, `json` + kiểm chữ ký nội dung | R03 nguyên văn; cùng luật cho file `out/` (R25) — plan-rules `sniff` |
| Q2 | **A** — giữ theo hội thoại; xoá hội thoại → xoá nội dung file ≤ 10 phút (1 chu kỳ sweeper 600 s), hàng metadata giữ (`purged_at`, `available=false`) | R28, R29; plan-db §4 |
| Q3 | **A** — làm `out/` ngay ở H2c, tối đa 5 file/job | R24–R26, AC-12; plan-runtime §5 |

## PLAN — chính xác hoá spec (backend-lead, không đổi nghiệp vụ)
| # | Luật | Chính xác hoá | Lý do |
|---|---|---|---|
| PL1 | R04 | `put` tách hai pha: `stage(key, body, {maxBytes, inspect})` ghi `<key>.part` + đếm + sha256 + kiểm R03 → `Staged{size, sha256, commit(), discard()}`; `commit` = fsync + rename (gọi **sau** khi DB commit, R05). Thêm `blob(key, mime)` (Dify upload, `Bun.file` lười) | R05 đòi rename sau commit; FormData cần `Blob` |
| PL2 | R29 | Thứ tự sweeper: **đánh dấu `purged_at` trước** (UPDATE … `FOR UPDATE SKIP LOCKED` RETURNING) → xoá nội dung → R27 xoá hàng. Nội dung còn sót (crash/lỗi xoá) do bước quét mồ côi (file > 1 h không có hàng hoặc hàng đã `purged_at`) dọn | "Xoá nội dung trước" để hở cửa: E12 gắn (R11) file đúng lúc sweeper đã xoá nội dung ⇒ tin trỏ file mất. Đánh dấu trước ⇒ R11 (`purged_at IS NULL`) không gắn được |
| PL3 | T2 | Không dùng `hono/body-limit`: bộ đếm byte trong `stage` (một chỗ, cả thân chunked); `Bun.serve.maxRequestBodySize = 32 MiB` làm chặn ngoài | Tránh hai lớp đếm cùng luật |
| PL4 | R24 | Câu `out/` do **Hub** nối vào **`system_prompt`** job agent; khối file (R15) nối vào `prompt` **chỉ khi** `A` ≠ ∅. Runtime không sửa prompt | Test khoá H1 A16 / H2b `direct.int:305` so `payload.prompt` nguyên văn |
| PL5 | R23 | Câu `isError` của tool MCP chỉ tiếng Anh (như `TOOL_ERROR_TEXT` H2a — model đọc): "This file is not attached to this message." | Một nguồn câu tool |
| PL6 | R26 | Gắn output: mỗi `(job_id, safe_name)` lấy bản mới nhất (`DISTINCT ON`) | Job bị requeue (cùng `job_id`) có thể đã đẩy output ở lần claim trước |
| PL7 | R09 | Thêm điều kiện `created_at > now() − 24 h` vào kiểm và câu gắn | Không gắn file sweeper sắp xoá |
| PL8 | R20 | `file ← arg` (Admin M2-R17 không cảnh báo) ở Hub là `invalid` như spec; command có input không phải `file` map `attachment` trước đây chạy với giá trị rỗng nay trả 422 `invalid` | Spec R20; ghi rủi ro K10 (`tasks.md`) |

## Readiness lần 1 — chính xác hoá thêm (spec-readiness, không đổi nghiệp vụ Q1–Q3; chi tiết `readiness.md`)
| # | Luật | Chính xác hoá | Lý do |
|---|---|---|---|
| PL9 | R24, R18 | `ALLOWED_TOOLS` (contract hub) + `Write` (cuối). Agent **bật theo cấu hình** `runtime_options.allowed_tools` (seed); mặc định giữ Read, Grep ⇒ payload H1/H2a/H2b y hệt. Hook: `Write` chỉ khi `realpath(dirname(file_path)) == realpath(work/<job_id>/out)` (không thư mục con, không `attachments/`, không gốc `work/<job_id>/`), khác ⇒ `path_not_allowed`; `Edit`/`MultiEdit`/`NotebookEdit` vẫn ngoài danh sách. `OUT_HINT` chỉ nối khi job có `Write` | H1 `ALLOWED_TOOLS` = Read/Grep/Glob ⇒ agent CLI thật **không ghi được** `out/` (Q3 = A vô hiệu); bật mặc định cho mọi agent làm đỏ H1 A27 (khoá) và mở quyền ghi khi chưa ai chọn. BA ba-worker §7 đã có ví dụ tool ghi (`Edit`), WRK-BR-07 "mọi tool đọc/ghi qua hook" |
| PL10 | R25, R26, P21 | Đếm ≤ 5 output và gắn output chỉ tính hàng của **lần claim hiện hành** (`a.created_at >= jobs.started_at`); bản lần claim trước không gắn (hết hạn R27) | Requeue (H2b) sau khi đã đẩy 5 output ⇒ lần chạy lại bị 409 hết; bản cũ trùng/lạc tên bị gắn nhầm |
| PL11 | R29, PL2 | `sweepOnce({db, storage, now, log?}) → {expired, purged, orphans, skipped}`: **một** transaction scope `system` mỗi lượt — `pg_try_advisory_xact_lock(hashtext('hub.attach.sweep'))` (false ⇒ `skipped: true`, 0 việc) → claim `FOR UPDATE SKIP LOCKED` + đánh dấu `purged_at` → xoá nội dung → DELETE (R27) → mồ côi → commit. E12 gắn (R11) chạm hàng đang claim thì chờ khoá hàng rồi thấy `purged_at` ⇒ 404. Vòng nền gọi cùng hàm; `AppDeps.attachments.sweep: false` tắt vòng nền (test) | Plan cũ vừa "khoá xact mỗi lượt" vừa "mỗi bước một transaction" ⇒ khoá nhả sau bước đầu, A128 không tất định. Crash giữa lượt ⇒ rollback đánh dấu nhưng hàng R27 (quá 24 h, PL7) và R28 (hội thoại đã xoá, P22) đều không còn đường tới user ⇒ lượt sau làm lại |
| PL12 | R02 | `displayName` cắt ≤ 200 **đơn vị UTF-16** (không tách cặp surrogate) thay cho 200 code point | zod `string().max(200)` đếm UTF-16 (bài học H2b readiness #6): 199 emoji + đuôi ⇒ `AttachmentSchema` từ chối response. DB `char_length ≤ 200` vẫn đúng (code point ≤ đơn vị) |
| PL13 | R29 | Quét mồ côi: `.part` > 1 h mà id còn hàng sống (crash giữa DB commit và rename, R05) ⇒ `rename` (hoàn tất `commit`) thay vì xoá | Không để hàng `available=true` mất nội dung vĩnh viễn |
| PL14 | R09–R11, R14 | Kiểm/gắn/tập file run chỉ cần DB — chạy mọi khi E12 có `db`, **không** phụ thuộc `AppDeps.attachments`. Vắng `attachments` ⇒ chỉ không mount `POST/GET /attachments*`, `/internal/jobs/:id/{attachments,outputs}`, sweeper; `/attachments` vẫn trong `PROTECTED_PREFIXES` (401 trước 404 — A141). Driver cần nội dung (Dify upload R22) mà vắng storage ⇒ `run.failed INTERNAL_ERROR` (chỉ xảy ra ở khung test) | Khung test H1/H2a/H2b dựng app không storage; tránh hai nhánh E12 |

## Gate duyệt — 2026-10-05
- Người dùng duyệt Gate H2c ("Oke"): CR-039 (gồm mục 7 tool `Write`), Q1–Q3 = A, storage ổ đĩa Hub + interface, tool `Write` tắt mặc định — bật theo agent qua seed, hook chỉ cho ghi `work/<job_id>/out/`, đổi hành vi H2a K10, PL1–PL14.

## BUILD — C1/C2 (backend-lead, không đổi nghiệp vụ)
| # | Task | Quyết định | Lý do |
|---|---|---|---|
| BC1 | C1 | `ATTACH_MAX_BYTES`/`ATTACH_ALLOWED`/`AttachMime`/`ATTACH_MIMES`/`AttachMimeSchema` đặt ở `packages/contracts/src/attach.ts`, `common.ts` re-export (`export * from "./attach"`) — import `../common` như plan | `common.ts` 403 dòng > trần 400 (`check:size`) |
| BC2 | C1 | `AttachmentNotFoundDetailsSchema.ids` max = `ATTACH_PER_MESSAGE_MAX` (10) — `errors.ts` import `./attachments` (không vòng: `attachments.ts` chỉ import `../common`) | Một nguồn hằng |

## BUILD — D1 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| D1-1 | `attachments_bound_ck` (plan-db §1) | Thêm `position IS NOT NULL` tường minh: `message_id IS NULL OR (bound_at IS NOT NULL AND position IS NOT NULL AND position BETWEEN 0 AND 9 AND conversation_id IS NOT NULL AND flow_id IS NOT NULL)` | `NULL BETWEEN 0 AND 9` = NULL ⇒ CHECK cho qua hàng đã gắn mà `position` NULL (test D1 bắt được). Không đổi nghiệp vụ (R12: hàng gắn luôn có thứ tự) |
| D1-2 | plan §3 ghi `(message_id IS NULL) = (bound_at IS NULL)` | Theo plan-db §1 (một chiều: có `message_id` ⇒ có `bound_at`) | FK `ON DELETE SET NULL` chỉ xoá `message_id`; CHECK hai chiều làm xoá message lỗi 23514 |
| D1-3 | Test khoá cũ của `packages/db` (không thuộc `tests/.lock`) | `migrate-hub.int` thêm `attachments` vào danh sách bảng hub (20 → 21); `hub-rls.int` thêm `attachments` vào bảng có RLS | Hai test liệt kê đúng tập bảng/RLS hiện có — cập nhật như H2a đã làm với `tool_confirmations` |
| BC3 | C2 | `HUB_JSON_SCHEMAS` thêm `JobAttachment` (ngoài `JobOutputResponse` của plan) + fixture 2 valid / 3 invalid | Không có key riêng, datamodel-codegen đặt tên lớp `Attachment` (suy từ tên trường); `plan-runtime` §1 dùng `list[JobAttachment]`. `DifyFileInput` để lớp sinh `Inputs1` (Runtime chỉ chuyển tiếp `inputs`) |
| BC4 | C2 | `JOB_FILE_NAME_RE` có `\x00-\x1f\x7f` ⇒ `biome-ignore lint/suspicious/noControlCharactersInRegex` (tiền lệ `admin-web/src/lib/download.ts`) | Cố ý cấm ký tự điều khiển |
| BC5 | C2 | `check:size` miễn `apps/agent-runtime/src/agent_runtime/contracts/hub.py` (sinh, 435 dòng > 400) — `tools/scripts/src/check-size.ts` + ca unit | File sinh "DO NOT EDIT", như `*.gen.ts`; không chia được |
| BC6 | C2 | Typecheck `apps/hub-api` xanh không cần sửa: `WorkflowInputValue` ở Hub là kiểu riêng (`commands/catalog.types.ts`), không suy từ contract. `runner.rules.allowedTools` (giao với `ALLOWED_TOOLS`) nay cho qua `Write` khi agent cấu hình — đúng PL9 (opt-in); mặc định giữ Read, Grep | — |
| BC7 | C2 | Unit (không khoá) sửa: `delta.test.ts` (15 lý do, `attachment` cuối), `hub.test.ts` (ca sai `Edit` thay `Write`; `HUB_JSON_SCHEMAS` 12 key), `hub-internal.test.ts` (`toEqual` +4 mã) | plan §2.2–2.3 |

## BUILD — PY-00/MK (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| PY0-1 | `runtimes/hub_http.py` | Chuyển nguyên văn `make_hub_client`/`NO_PROXY_MOUNTS`/`CREDENTIAL_TIMEOUT`; `dify/credential.py` export lại bằng `import X as X` (pyright strict coi là re-export); `dify/client.py` import thẳng từ `hub_http` | Không đổi hành vi; test dify import theo đường cũ vẫn chạy |
| PY0-2 | `cli/files/fetch.py`, `outputs.py` (rt §3.2, §5) | Gộp `client, hub_url, job, deadline, stop` vào dataclass `FilesCall` ⇒ `fetch_attachments(call, items, dest)`, `send_outputs(call, out) -> tuple[str, ...]`; `items: Sequence[JobAttachment]` (contract sinh C2); `job` qua Protocol `JobRef(id, token)` (khớp `ClaimedJob`) | ruff `PLR0913` (≤ 4 tham số, repo không dùng `noqa`); ngữ nghĩa giữ như plan |
| PY0-3 | stub `rules.py` | Đủ hằng §4 + alias `FetchClass`/`OutputClass`/`OutKind`/`OutSkip` + `OutEntry`; mọi hàm ném `NotImplementedError` (QW-PU đỏ đúng lý do) | — |
| PY0-4 | `pytest -m int` | 133/134 xanh (mọi dify H2a xanh, chạy DB tạm riêng vì DB test H1 dùng chung đang bị test khác migrate dở). Đỏ `result_int_test::test_wrk_fr_03_event_sequence`: `job.result` có khoá `outputs` thừa — do contract C2 thêm `JobResultEvent.outputs` (Runtime dump `None`); sửa ở PY-03 (rt §1 `events.result`: khoá `outputs` chỉ khi ≠ ∅) | Không thuộc PY-00 (tách file) |
| MK-1 | `done-h2c.ts` | `h2cSteps()` dựng từ `h2bSteps()`; `done-h2b.ts` export `byTitle`/`extend` (không đổi hành vi). Bước 12 H01 H2c = bản sao bước H01 H2b (`needsDev`, `HUB_URL`/`AUTH_URL`) đổi thư mục cuối | test-plan §7.1 |
| MK-2 | `test:h2c:stack` | `HUB_MAX_CONCURRENT_RUNS=2 HUB_ATTACH_DRIVER=local …--config=bunfig.stack.toml…`; `HUB_ATTACH_DIR` **không** đặt trong script — harness stack (`_stack.ts` H2c, qc) đặt `mkdtemp` tuyệt đối khi spawn Hub | Script package.json không tạo được thư mục tạm tuyệt đối đa nền tảng; test-plan §3 dòng Stack đã giao `mkdtemp` cho harness |
| MK-3 | `tools/hub-dev/src/dev.ts` | `hubApiEnv(env, attachDir?)`: `HUB_ATTACH_DRIVER=local`; `HUB_ATTACH_DIR` = env (khác rỗng) hoặc thư mục `mkdtemp(tmpdir()/hub-dev-attach-*)` mỗi lần `startHubDev`, xoá khi `stop`; hạn mức/sweeper để mặc định Hub | tasks MK "thư mục tạm mỗi lần"; `.env.local` để trống DIR không làm hỏng hub-dev |
| MK-4 | `.env.example` | `HUB_ATTACH_DRIVER=local`, `HUB_ATTACH_DIR=` (trống — Hub đòi tuyệt đối; ví dụ `<repo>/.data/attachments`), `HUB_ATTACH_TENANT_MAX_BYTES=`, `HUB_ATTACH_SWEEP_S=`; thêm `AGENT_RT_HUB_URL=` (chưa có dòng; plan-runtime §7 ghi chú) | Đường dẫn tương đối `.data/attachments` sẽ làm Hub thoát (plan-rules `parseAttachEnv`) |

## BUILD — B0 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| B0-1 | TD #52 (P18) | `runner/job/job-follow.ts`: `EventQueue`, `JOB_POLL_MS`, `JobFollower.follow` (+ `#poll`, `#finishStep` chép nguyên thân), `emitStep` (thay `#emit`, dùng cho cả `step.started` và `step.finished`). `job-agent-runner.ts` 380 → 275 dòng, re-export `EventQueue`/`JOB_POLL_MS` (giữ đường import cũ) | Không đổi hành vi; chừa chỗ B6 (trần 400) |
| B0-2 | `job-follow.ts` | Kiểu `FollowTask = {run: RunRef; detail?; emit?}` thay vì import `AgentTask` | Tránh import vòng `job-agent-runner` ↔ `job-follow` (depcruise) |
| B0-3 | stub `rules` §1–4 | Ngoài các file `rules` còn stub `storage.local.ts` (`createLocalStorage`) và `sweeper.ts` (`sweepOnce`, `startAttachmentSweeper`) — cùng chữ ký `plan-rules` §4 | QW-A1 (AC-13, AC-15) import được ⇒ đỏ đúng lý do `not implemented`, không đỏ vì thiếu module. Hằng (`SNIFF_HEAD`, `RUN_FILES_MAX*`, `OUT_HINT`, `TOOL_FILE_TEXT`, `*_MS`, `SWEEP_BATCH`) ghi giá trị plan; `AttachExt = keyof typeof ATTACH_ALLOWED` đặt ở `attachment.rules.ts` (contract chưa có) |
| B0-4 | `mcp.rules`/`command-input.rules` | Trường tuỳ chọn chỉ thêm kiểu, **bị bỏ qua** tới B7/B8 (tiền lệ H2b B0 `excludeIds`/`onlyKeys`): `McpToolsInput.hasFiles?`, `toolInputSchema(inputs, _withFiles = false)`, `BuildInputsInput.attachment?`, kết quả ok `files?` (`BuildInputsFile`). Stub mới `fileArg` (ném) + `TOOL_FILE_TEXT`. `agentToolKeys(ids, catalog, hasFiles?)` chuyển `hasFiles` chỉ khi có (vắng ⇒ input y hệt H2a) | Test khoá H2a (`command-input`, `mcp`) gọi với đầu vào cũ ⇒ kết quả giữ nguyên |


## BUILD — PY-01/PY-02 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| PY1-1 | Phạm vi PY-01 | Ngoài `rules.py` (tasks) làm luôn thân `dirs.py`, `fetch.py`, `outputs.py` (hàm IO độc lập, chưa nối `JobRun`) + unit dev `files/test_{dirs,fetch,outputs}.py` (`httpx2.MockTransport`) | Test khoá P25 gọi thẳng `fetch_attachments` ⇒ `test_files_rules.py` chỉ xanh hết khi có `fetch`; nối vào `JobRun` ở PY-02 (tải) / PY-03 (`_close` → `send_outputs`) |
| PY1-2 | `pick_outputs` | Thứ tự `skipped` = thứ tự duyệt `entries` cho các mục bị loại, rồi `over_limit` cuối (một mục mỗi file) | QW-PU: P05 so `Counter`, không ép thứ tự |
| PY1-3 | `fetch.py` `path` | `realpath(target.parent) == realpath(dest)` giữ làm lớp phòng thủ hai; với tên đã qua `valid_job_file_name` (không `/`) nhánh này gần như không xảy ra — `dest/sub` symlink chỉ chạm được qua tên có `/` ⇒ `bad_name` trước | QW-PU P25 `dest/sub` (test-plan-log) — làm theo test |
| PY1-4 | `fetch.py` dừng/hạn | `until_stopped(coro, stop)` (race task ↔ `stop.wait()`, huỷ task) dùng chung cho tải và gửi; hạn job = `asyncio.timeout(deadline − now)` bao cả vòng (kể cả `backoff`), mỗi lần thử `asyncio.timeout(60)` riêng ⇒ lỗi mạng (thử lại). Hết lượt thử: `status None` ⇒ `network`, 5xx ⇒ `http`. Lỗi toàn vẹn (`size`/`sha`) không thử lại | plan-runtime §3.2 |
| PY1-5 | `fetch.py` dọn file | Chỉ xoá file **do lần tải này tạo** (danh sách `written`), không xoá symlink/file đặt sẵn trong `dest` (đã có `prepare_job_dirs` làm mới) | Không đụng đích symlink (AC-08) |
| PY1-6 | `outputs.py` | `scan_out` (scandir không theo link) công khai để PY-03 dùng; lý do bỏ ngoài `OutSkip` khi log: `rejected` (4xx/hết lượt), `unauthorized` (401 ⇒ ngừng), `bad_response` (201 thân sai); `budget = max(60, deadline − now)` bao cả `send_outputs` | plan-runtime §5 |
