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

## BUILD — B1 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| B1-1 | `config/env-deps.ts` `attachEnvOf` · `server.ts` | Có **bất kỳ** `HUB_ATTACH_DRIVER`/`HUB_ATTACH_DIR`, hoặc `APP_ENV=production` ⇒ kiểm chặt `parseAttachEnv` (sai ⇒ `fatal env`, thoát 1). development/test vắng **cả hai** ⇒ Hub lên **không** `attachments` (PL14: route file không mount) + `warn attachments_disabled` | Test khoá H1 `seed.int` A46, H2b `orchestrator-tenant` A65, `run-limit` A87 và harness stack H1/H2a/H2b spawn `server.ts` với `...process.env` không có env H2c (đòi `/health` 200). A25 "driver vắng" có `HUB_ATTACH_DIR` ⇒ vẫn thoát ≠ 0. `parseAttachEnv` giữ nguyên chữ ký/luật plan-rules §4 (vắng driver ⇒ ném) |
| B1-2 | `storage.local.ts` | Gốc = `realpath(dir)` sau `mkdir -p 0700`; không `win32`: gốc có bit nhóm/khác ⇒ `chmod 0700`; ghi thử `.probe-<uuid>` (`wx`) rồi xoá. Mọi lỗi ⇒ `Error("attachment storage unusable (<mã fs>)")` — **không** đường dẫn (A25: log không chứa giá trị env). Thư mục tenant: `realpath` phải **bằng** `<gốc>/<tenant>` (symlink/junction ⇒ `StorageKeyError`). `open`/`blob` chỉ file đã commit; `list` bỏ tên không phải `<uuid>`/`<uuid>.part`, sắp `(key, partial)`, trang sau = key > `after` | R04, P23, Q-T5. Log `attachment-path-escape` ở service (B2) khi bắt `StorageKeyError` — driver không nhận logger (QW-A1 lệch #4) |
| B1-3 | `lib/unread-body.ts` `closeUnreadBody()` (gắn toàn app sau `requestContext`) | Phản hồi ≥ 400 cho request **có thân không phải JSON** ⇒ `Connection: close`; thân không `Content-Length` (chunked) còn dư ⇒ đọc bỏ (≤ `MAX_REQUEST_BODY_BYTES` 32 MiB, ≤ 10 s, quá ⇒ huỷ) **trước** khi trả. Thân có `Content-Length` không đọc bỏ (giữ 413/409 sớm — A02, A21 `sentAtResponse`) | Đo trên Bun 1.3.14 (QW-A1 lệch #2): Bun.serve tự bỏ phần dư khi có `Content-Length`, nhưng **không** đóng socket theo `Connection: close` (vẫn phục vụ request kế); client `fetch` của Bun bỏ dở thân chunked rồi dùng lại kết nối ⇒ request kế 400. Chỉ đọc bỏ mới giữ kết nối nhất quán (unit `unread-body.test.ts` dựng Bun.serve thật: 413 → `/health` 200 ×3). `Connection: close` vẫn gửi cho proxy/client tuân RFC 9112 §9.6. JSON không áp: route JSON đọc trọn thân nhỏ |
| B1-4 | `AttachmentStorage.stage` | Lỗi giữa chừng (`StorageTooLarge`/`StorageRejected`/I/O) ⇒ xoá `.part`, **nhả khoá đọc, không `cancel`** `body` (plan-rules §4 ghi "huỷ đọc") | Để B1-3 đọc bỏ được phần dư của thân chunked; với `Content-Length` Bun tự bỏ |
| B1-5 | `AppDeps.attachments` | Kiểu `AttachmentDeps = {storage, tenantMaxBytes, sweepS, sweep?}` ở `attachments/storage.ts` (đúng khoá helper `startHubH2c` truyền). `server.ts` không đặt `sweep` (vắng = chạy — vòng nền ở B10). `maxRequestBodySize` (P4) để B2 (đúng cột File của B2), hằng sẵn `MAX_REQUEST_BODY_BYTES` | Phạm vi task |
| B1-6 | `parseAttachEnv` | Không import `node:path` (depcruise `rules-must-be-pure`): `isAbsoluteFor(dir, platform)` = `/^([A-Za-z]:)?[\\/]/` (win32) / `startsWith("/")` — đối chiếu khớp `path.win32/posix.isAbsolute` trên 12 mẫu. Message lỗi chỉ tên biến, không chữ số | R27 rules: message không chứa giá trị (vd. `9`, `-1`) |
| B1-7 | `blob(key, type)` | `Bun.file(path, {type})` — kiểu `text/*` Bun tự thêm `;charset=utf-8` (`text/plain` → `text/plain;charset=utf-8`) | Ghi cho B7 (Dify upload `txt/md/csv`): so sánh/gửi `type` cần biết điều này |
| PY2-1 | `JobRun._prepare_files` | Đầu `_execute` (trước `_load_session`), một lần mỗi claim: không file ∧ role ≠ `agent` ⇒ không đụng đĩa (H2b y hệt); `prepare_job_dirs(attachments=bool(items), out=role=="agent")` lỗi OS ⇒ `finish_failed attachment` (`path`); `FetchFailed` ⇒ `finish_failed` `Failure("failed","INTERNAL_ERROR","attachment","attachment fetch failed: <why>")`; `FetchTimedOut` ⇒ `_close(TIMED_OUT)`; `FetchStopped` ⇒ `_apply("stopped")` (cancel ⇒ `cancelled`; shutdown/lost ⇒ `stopped_no_write` + `forget`) | plan-runtime §3.3 |
| PY2-2 | `HostConfig` | Thêm `hub_url` (= `Settings.hub_url`, `main.host_config`) + `hub_transport` (test, như `DifyConfig`); client `make_hub_client` mở theo lần tải; `stop` = `control.stopped` | Không env mới (§7) |
| PY2-3 | Hồi quy H1 `result_int_test::test_wrk_fr_03_event_sequence` | `events/stream.encode_event`: `job.result` có `outputs is None` ⇒ dump `exclude={"outputs"}` (chỉ khoá này; `None` khác như `percent`, `reason` giữ nguyên). Sửa sớm ở PY-02 (PY0-4 ghi PY-03) | Khoá chỉ khi ≠ ∅ (F10); `exclude_none`/`exclude_unset` toàn cục đổi sự kiện khác |
| PY2-4 | Ngoài PY-02 | `_close` → `send_outputs`, `Verdict.outputs`, `events.result(..., outputs)`, hook `Write` (PL9) để **PY-03** đúng tasks.md (sau QW-P/Q3) | Thứ tự PY khối tasks |

## BUILD — B5/B10 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| B5-1 | `internal/attachments.service.ts` | Một transaction `system`: `jobByTokenHash` → `id`/`type='agent.cli'`/`AgentCliJobSchema` → `attId` so **nguyên văn** với `payload.attachments[].id` (id sai dạng/chữ hoa không tới DB — A89) → `jobAttachment(tx, attId, job.tenantId)` (plan-db §2.5, đặt trong `credential.repo.ts`; `CredentialJob` + `tenantId/userId/runId`). Không hàng ⇒ 401; `purged_at` ⇒ 404; file mất ⇒ 404 + `error attachment-content-missing`; ok ⇒ `info attachment-served{attachment_id, job_id}` | R17, P16; một thân 401 dùng lại câu `credential.routes` |
| B5-2 | Thân 200 | `storage.blob(key, "application/octet-stream")` (đọc lười) thay vì `open().stream`; `Content-Length` = kích thước file trên đĩa | Thân `ReadableStream` ⇒ Bun gửi chunked, mất `Content-Length` (A80) |
| B5-3 | `lib/blob-body.ts` (`blobResponse` + `keepBlobBody()` gắn trong `app.ts` ngay **trước** CORS) | Hono `cors` gọi `c.header("Vary")` sau handler ⇒ `Context` bọc lại `Response(body)` ⇒ blob thành stream (đo Bun 1.3.14: có CORS ⇒ `transfer-encoding: chunked`). `keepBlobBody` sau `next()` dựng lại `Response(blob)` với status/header cuối (`c.res = undefined` trước để setter không bọc lại). **B3 `/content` dùng chung** `blobResponse` | Giữ `Content-Length` (R13, R17) mà không đọc file vào RAM |
| B5-4 | `app.h2c.ts` | B5 tạo `mountH2c(app, {db, attachments, log, signal})` (gọi trong `createApp` khi có `db` ∧ `attachments`, PL14); B2/B3 thêm route `/attachments*`, B10 thêm sweeper | Một chỗ nối H2c |
| B5-5 | Test khoá lệch (báo qc) | **A81**: `jobInRun(..., {tools: []})` ⇒ helper H2a `expect(JobPayloadSchema…)` đỏ (`mcp.tools` `min(1)`, regex `^[a-z0-9-]{2,32}$`). **A83**: `update hub.attachments set tenant_id = beta` vi phạm `attachments_key_ck` (D1: `storage_key = tenant_id || '/' || id`) ⇒ lỗi SQL trước khi gọi Hub. Bản sao tạm (không commit) `tools: ["dich"]` + lệch tenant qua `hub.jobs.tenant_id` ⇒ 10/10 xanh | Không sửa test khoá; qc sửa helper/ca (vd. `tools: ["dich"]`; A83 đổi cả `storage_key` hoặc lệch `jobs.tenant_id`) |
| B10-1 | `AttachmentStorage.promote(key)` (+ driver `local`) | Interface B1 không có thao tác hoàn tất `.part` ⇒ thêm: `.part` → `<key>` (rename); `<key>` đã có ⇒ chỉ xoá `.part`; không có ⇒ ok | PL13 cần rename mà `remove` xoá cả hai |
| B10-2 | `sweepOnce` | Đúng PL11/plan-db §4 trong một `withHubScope(system)`: `pg_try_advisory_xact_lock` false ⇒ `{0,0,0,skipped:true}`. 4.1 hạn = `now − UNBOUND_TTL_MS` tính ở TS (tham số `::timestamptz`, cùng nghĩa `interval '24 hours'`); `expired` = số hàng **DELETE** (hàng `remove` lỗi giữ `purged_at`, lượt sau claim lại — A129). 4.2 `purged` = số hàng đánh dấu (remove lỗi ⇒ warn, bước mồ côi dọn). 4.3 `orphans` = số mục xoá + `promote`. Mảng id truyền literal `{…}::uuid[]` (drizzle `sql` nở mảng thành danh sách) | AC-13, A127 `[500, 1]` |
| B10-3 | Con trỏ quét mồ côi | `WeakMap<AttachmentStorage, key>`: lô đầy (500) ⇒ lượt sau `after = key cuối`; thiếu ⇒ về đầu | "con trỏ trong bộ nhớ" (plan §5.8), nhiều storage trong cùng tiến trình test không lẫn nhau |
| B10-4 | Log | `info attachment-sweep{expired, purged, orphans, ms}` chỉ khi tổng > 0; `warn attachment-remove-failed{attachment_id}` cho cả lỗi `remove` và `promote` | plan-errors §5 |
| B10-5 | Ca phụ thuộc task khác | A122/A123 (GET `/attachments*` 404 — B3), A124 (E10 `available`, E12 `attachment_ids` — B4), A125 vế `/content` 200 (B3) chỉ xanh khi B3/B4 xong; phần sweeper của các ca này đúng (kiểm DB/đĩa) | Phụ thuộc tasks |
| B5-5/TC | `internal-download` A81/A83, `sweeper` A129 (qc) | Phán test sai, sửa tối thiểu giữ id: A81 `tools: [WF_KEY.dich]`; A83 lệch tenant qua `hub.jobs.tenant_id`; A129 giả lỗi `remove` bằng storage bọc ngoài (thay file chỉ đọc/chmod). Lock: chỉ 2 dòng hash | `test-plan-log` "Tranh chấp" TC-1..3; code sản phẩm không đổi |

## BUILD — B2/B3 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| B2-1 | `attachments.service` hạn mức (R06, plan-db §3) | Kiểm sớm + transaction chốt (`pg_advisory_xact_lock(hub.attach.tenant)` → SUM → INSERT) chạy scope **`system`**, `tenant_id`/`user_id` lấy từ JWT, câu lọc `tenant_id` tường minh (plan-db §3 ghi scope `user`) | RLS `attachments_hub_rw` scope `user` lọc cả `user_id` ⇒ SUM chỉ thấy file của chính user, hạn mức tenant (R06) bị vượt khi nhiều user. `GET` (R13) giữ scope `user` |
| B2-2 | Thân upload | Bọc `req.body` bằng stream đếm (`highWaterMark: 0`, không đệm thêm) để log `attachment-upload-aborted{bytes}` và phân biệt lỗi đọc (client đứt ⇒ 500 + warn) với lỗi I/O; xong/lỗi đều nhả khoá thân gốc (B1-3/B1-4: tầng HTTP đọc bỏ phần dư). Có `Content-Length` mà số byte đọc được ≠ ⇒ coi như client đứt (bỏ `.part`, không INSERT) | AC-02/A08; không INSERT file cụt |
| B2-3 | Log `attachment-rejected` | Mọi lỗi 4xx của upload (400/409/413/415), `code` = số HTTP, `origin: "upload"`; thêm `error attachment-path-escape{key: id}` khi `stage` ném `StorageKeyError` (500) | plan-errors §5; A11 đếm `code === 415` |
| B2-4 | `storage.local` `writeAll` (B1) | `writeSync(fh.fd, …)` thay `FileHandle.write` | Đo Bun 1.3.14 (upload 20 MiB × 10, cùng tiến trình): async write giữ bộ đệm ⇒ RSS +7,2–7,8 MiB/lần; `writeSync` +4,1 (≈ chỉ đọc bỏ thân). PF1 (khoá, không chặn mốc): p95 thời gian đạt (~0,1–0,15 s/lần); RSS đo 8,7–10,6 MiB/lần ở 3/5 lượt chạy (2/5 đạt ≤ 8) — phần lớn là khởi động lần đầu (kết nối DB, JIT, bộ đệm thân Bun); vòng thứ 2 trở đi ~1 MiB/lần (đo tạm, không commit) |
| B2-5 | `parseFilenameHeader`/`displayName` | Dải ký tự vô hình dựng bằng `RegExp` từ mã số | biome đổi escape `\u` trong regex thành ký tự thô (NUL/bidi lọt vào source) |
| B2-6 | `contentLengthOf` | `Content-Length` không phải số nguyên thập phân ⇒ coi như vắng (bộ đếm `stage` là chốt, PL3) | Bun đã từ chối header sai ở tầng HTTP; phòng thủ |
| B2-7 | `ERROR_MESSAGES.INTERNAL_ERROR` | Giữ câu H1 "Internal server error" (plan-errors §1 ghi "Internal error") | Không đổi câu đã có (H1); client dịch theo `code` |
| B3-1 | `/content` thân | `storage.blob(key, mime)` (đọc lười) + `blobResponse` (`lib/blob-body.ts`, B5-3) giữ `Content-Length`; header `Content-Type` đặt tay = `mime` (không `;charset` — B1-7) | Thân `ReadableStream` ⇒ Bun gửi chunked (A30) |
| B3-2 | `/content` + `Range` | Có header `Range` ⇒ thân `blob.stream()` (200 toàn bộ, không `Content-Range`, **không** `Content-Length` — chunked) | Thân `Bun.file` ⇒ Bun tự trả 206 theo `Range` (đo: `Accept-Ranges: none`/xoá header request không tắt được); R13 "Range bỏ qua" (A36) |
| B3-3 | `/content` lỗi kho | File mất ⇒ 404 + `error attachment-content-missing`; `StorageKeyError` ⇒ 500 + `attachment-path-escape`; lỗi I/O khác ⇒ 500 + `error attachment-open-failed{attachment_id, error}` | plan-errors §1, §5; không lộ đường dẫn (A35) |

## BUILD — B4 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| B4-1 | `attachments/run-files.ts` (mới) | `checkSendable(db, u, ids)` + `bindRunFiles(tx, o, p)` đặt ở file riêng (plan §4 ghi `checkSendable` trong `attachments.service.ts`) — chỉ cần `Db`, không `AttachmentStorage` | PL14: E12 kiểm/gắn khi app không `attachments` (A141); `AttachmentService` đòi storage |
| B4-2 | `RunService.checkSendable(u, ids)` · `runs.routes` | Route gọi qua `RunService` (đã có `db`) thay vì thêm tham số thứ 5 cho `sendMessageRoutes`; `start(u, conv, req, plan?)` **giữ** chữ ký: file gắn theo `req.attachment_ids` trong `createRunTx`, `A` lấy từ giá trị trả về `createRunTx` → `RunContext.files` (plan §5.2 ghi `start(…, plan, files)`) | `check:fn` `PARAM_LIMIT = 4`; `CurrentFile[]` của bước kiểm không cần cho tạo run (gắn lại bằng id trong transaction) |
| B4-3 | Thứ tự R10 | `parseJson` → `checkSendable` (một transaction `user` riêng, 404 `ATTACHMENT_NOT_FOUND{ids}` theo thứ tự gửi) → `routeMessage`/`prepareCommand(attachments)`/`prepareMention` → `createRunTx` (flow lạ 404 → `FLOW_BUSY` → 429 → INSERT run/message → `bindRunFiles` → `setRunFiles` → `decideConfirmations`) | A50–A52; gắn thua (A53) ném 404 trong transaction ⇒ rollback cả run/message |
| B4-4 | R14 | `runFileRows` (plan-db §2.3, `LIMIT 11`) bỏ qua khi flow mới ∧ không `ids`; kind `command` lọc ở SQL **và** `pickRunFiles`; `runs.attachment_ids` chỉ UPDATE khi `A ≠ ∅` (mặc định `'{}'`). Mảng uuid truyền literal `{…}::uuid[]` (B10-2) | plan §5.2 bước 4 |
| B4-5 | `buildInputs` (P13) làm sớm ở B4 | Thêm nhánh `fileInput` (lệch map ⇒ `invalid` bất kể giá trị; `file ← attachment` có file ⇒ `files`, thiếu + bắt buộc ⇒ `missing`); `CommandService.prepare` nhận `req.attachments` → `attachment = attachments[0]` (T9); `PreparedCommand.files?`/`BoundCommand.files?` (vắng khi rỗng). **B7** còn: upload Dify + điền `inputs[input]` ở driver | A62 (`/hoadon ghi chú` + file ⇒ 200, khoá B4) cần `file ← attachment` không còn `CMD_MISSING_ARG`; rules `command-input-h2c` R31–R34 xanh, H2a `command-input` khoá xanh |
| B4-6 | E10/E11/preview | `conversations.repo.messageAttachments(tx, o, ids)` một câu cho cả trang (`message_id = ANY`, lọc `tenant_id`/`user_id`, `ORDER BY message_id, position`) → `toAttachmentRef` → `toMessage(m, run, responder, refs)` | R12, plan-db §2.6 |
| B4-7 | PF2 (perf, không chặn mốc) | Đo Windows dev (Postgres local ~1,5 ms/khứ hồi): E12 10 id − không id ≈ +25 ms p95 (median: `checkSendable` 6 ms = BEGIN/set_config/SELECT/COMMIT; trong transaction +~10 ms = bind + `runFileRows` + `setRunFiles`) > ngân sách 5 ms. Không gộp: R10 bắt kiểm **ngoài** transaction tạo run | Báo lead/qc: ngân sách 5 ms cần đo lại trên máy Linux/CI hoặc nới; đổi thiết kế (gộp kiểm vào transaction) trái R10 |

## BUILD — PY-03/PY-04 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| PY3-1 | `JobRun._close` | `pump.drain()` → `_send_outputs(v)` → `FinishTx`/`host.close`. Gửi chỉ khi `v.failure is None` ∧ `wants_outputs(role, v.output)`; `FilesCall(make_hub_client(hub_transport), hub_url, job, deadline, control.stopped)` — token và `out/` của **lần claim hiện hành** (`prepare_job_dirs` đã làm mới `out/` đầu claim, F11). id (≤ 5) ⇒ `replace(v, outputs=ids)`; log `job.output_skipped{why,status}` / `job.outputs_skipped{reason:no_hub_url}` (warn) / `job.outputs{sent,skipped,ms}` do `send_outputs` (PY1-6) | plan-runtime §5, F9 (job còn `running` khi gửi) |
| PY3-2 | `RunEvents.result` | Chữ ký `result(job, output, usage, meta: ResultMeta \| None = None)` với `ResultMeta(session_resumed=False, outputs=())` thay `(…, resumed, outputs=())` của plan; `runtimes/dify/host.py` bỏ đối số `False` (mặc định, cùng nghĩa). Khoá `outputs` chỉ khi ≠ ∅ (cùng PY2-3 ở `encode_event`) | ruff PLR0913 (max-args 4) — gộp tham số như `FilesCall`, không `noqa` |
| PY3-3 | Hook `Write` (PL9) | Sau `is_path_allowed` (nhãn H1 giữ: `outside`/`other_job`/…), mỗi đường dẫn `Write` phải có `dirname(realpath(p)) == realpath(work/out)` — chặt hơn `realpath(dirname(p))` của plan: symlink `out/x` trỏ tới file khác **trong** job (vd `attachments/`) cũng bị chặn. Sai ⇒ `path_not_allowed` nhãn `write_scope`; `Write` không có khoá `*path*` ⇒ deny `write_scope` (fail-closed). `Write` ∉ `allowed_tools` ⇒ `tool_not_allowed` như H1 | sd PL9, P51 |
| PY4-1 | `fake-cli` `providers/fake/files.py` | `#fake:files` ⇒ `<tên>:<sha256>` file thường (không theo symlink, bỏ thư mục) trong `attachments/`, sắp code point, vắng/rỗng ⇒ `(no files)`. `#fake:out=<a>,…` (≤ 10, bỏ tên rỗng/`.`/`..`/có `/` `\`), `#fake:out-size=<n>` (chặn trên 20 971 521), `#fake:out-link=<tên>` ⇒ symlink → `/etc/hostname`; `out/` vắng hoặc là symlink (job không phải agent, R24) ⇒ không làm gì. `directives.py` không đổi (regex `#fake:([a-z_-]+)` đã nhận `out-size`/`out-link`) | plan-runtime §6 |
| PY4-2 | Thứ tự trong `provider.py` | `#fake:out*` ghi ở cuối `_side_effects` (sau `usage`/`sleep`, trước `ratelimit`/`is-error`/`badjson` và kết quả); `#fake:files`, `#fake:write` là nhánh thân (`_body`, ưu tiên `files` → `write` → `read`…) ⇒ chạy **sau** `#fake:sleep` | test-plan-log QW-P lệch #3: P51 tạo symlink `out/l.md` trong lúc `sleep` |
| PY4-3 | `#fake:write=<path>` | `_guarded(job, "Write", {"file_path": path})` (hook thật PY3-3, `allowed_tools` của payload): cho ⇒ ghi `fake write\n` vào `work/<job_id>/<path>`, thân `written`; chặn ⇒ `denied:<reason>` | P51 |
| PY4-4 | Lệch test đã khoá (QW-P) | Theo test: P42 tên `Báo-cáo.md` (chỉ thị không truyền được khoảng trắng); P31 shutdown khi đang tải ⇒ `stopped_no_write`, cha ghi `orphaned` (H1 §1.5) — code PY-02 đã đúng, không đổi | test-plan-log QW-P lệch #1, #4 |

## BUILD — B6 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| B6-1 | `AgentTask.files?` · `agentFiles(task)` | Chỉ job vai `agent` dùng `files` (`payload.attachments`, khối file, `hasFiles`); Orchestrator nhận danh sách qua `LoopInput.attachments` → `PromptInput.attachments` (không `payload.attachments`). `orchestrator.service` truyền `ctx.files` cho job `agent` (delegate) + `attachments` khi `A ≠ ∅`; `direct-driver` truyền `files: ctx.files` | P9, P11; A70, A75, A79 |
| B6-2 | Tên trong khối file | Khối Orchestrator dùng `safe_name` (như tin user); khối job agent dùng tên **đã khử trùng** (`jobAttachments` → `agentFilesBlock(attachments)`) — khớp đường dẫn `attachments/<name>` Runtime ghi | R15, R18; A72/A73 |
| B6-3 | `OUT_HINT` | Áp **sau** `buildJobPayload` theo `payload.allowed_tools` ∋ `Write` (đã giao `ALLOWED_TOOLS`; Orchestrator luôn `[]`; Dify agent không qua `JobAgentRunner`), không phụ thuộc có file; chạm `SYSTEM_PROMPT_MAX` ⇒ giữ nguyên + `warn attachment-out-hint-dropped{run_id, agent_id}` | P10, PL9; A74 |
| B6-4 | `agentToolKeys(ids, catalog, hasFiles)` | Hub **luôn** truyền `hasFiles = A ≠ ∅` (P12): run không file ⇒ bỏ mọi workflow có input `file` (kể cả tuỳ chọn — đổi so với H2a, K10). Vế `true` (A78 `hoadon-file` ∈ tools) cần `mcpToolsFor(hasFiles)` của **B8** — A78 còn đỏ tới B8 (đúng test-plan-log QW-A2) | P12, R23 |
| B6-5 | `jobFileNames` | Bớt byte bằng helper riêng trong `run-files.rules.ts` (không export `cutBytes` của `attachment.rules.ts` — tránh đụng file B7 đang sửa); không đuôi → `name-2` | plan-rules §3 |
| B6-6 | `prompt` + khối > `PROMPT_MAX` | Không cắt: `buildJobPayload` → null ⇒ `job-payload-invalid` như H1 (khối ≤ 10 dòng, `PROMPT_MAX` 200 000) | Hiếm; không tự đổi nội dung người dùng |

## BUILD — B9 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| B9-1 | `AttachmentService.ingest(target, input, log)` | Luồng §5.1 tách khỏi `upload` thành `ingest` theo `IngestTarget{tenantId, userId, origin, jobId, conversationId, flowId, guard?}`; `upload(u, …)` = `ingest` origin `upload` (hành vi B2 giữ nguyên); `ingestOutput(job, …)` cho R25 (plan §4 ghi `ingestOutput` trong service). `countedBody` chuyển sang `attachments/counted-body.ts` | Một luồng tên/loại/chữ ký/20 MiB/hạn mức/hai pha cho cả upload và output (R25 "Hub áp R02, R03, R06"); `check:size` |
| B9-2 | P21 · PL10 | `countJobOutputs` (plan-db §2.5, `created_at >= jobs.started_at`) ≥ `JOB_OUTPUTS_MAX` (5) ⇒ 409 `ATTACHMENT_QUOTA_EXCEEDED` — kiểm **sớm** (transaction `system` riêng, trước khi đọc thân) **và chốt** trong transaction INSERT sau khoá tenant (`guard`) ⇒ gửi song song cùng job không vượt 5. Thứ tự lỗi: 401 → 409 (≥ 5) → 400 header → 415 đuôi → 413/400 `Content-Length` → 409 hạn mức sớm → (thân) 413/415 chữ ký/400 rỗng → 409 chốt | plan §5.5; khoá tenant đã tuần tự hoá INSERT của tenant |
| B9-3 | Xác thực `/outputs` | `bearerJobToken` → `jobByTokenHash` (`running`) → `id` khớp ∧ `agent.cli` ∧ `AgentCliJobSchema` ∧ `payload.agent.role = 'agent'` (dùng chung `agentJob` với tải R17); mọi sai ⇒ 401 `UNAUTHORIZED` một thân + `WWW-Authenticate: Bearer`. Chủ = `jobs.tenant_id`/`jobs.user_id`, `conversation_id`/`flow_id` = payload, chưa `message_id` | P16, plan §5.5; A93 |
| B9-4 | Lỗi `/outputs` | Route bắt lỗi → `mapError` → `toErrorBody` + `Cache-Control: no-store` (`app.onError` không thêm `no-store`); 500 log `attachment-output-failed` (`safeErrorFields`, không tên file/token). Log `attachment_uploaded`/`attachment-rejected` origin `output` thêm `job_id` | plan-errors §1 nội bộ, §5; A91, A94 |
| B9-5 | `bindOutputs` (R26, P15, PL6) | SQL plan-db §2.4 nguyên văn ở `attachments.repo`, gọi qua `run-files.bindRunOutputs` (depcruise `no-cross-module-repo`) trong `SseWriter.#insertAnswer` ngay sau INSERT tin assistant, **chỉ** khi `status='finished'` (failed/cancelled không gắn — R27 dọn). Thứ tự khoá `flows → runs → messages → attachments → flows → jobs` (P8). `finish` tách `#insertAnswer` | `check:fn` (`finish` 57 > 50 dòng) |
| B9-6 | `X-Content-SHA256` | Không dùng ở `/outputs`: Runtime không gửi (plan-runtime §5), phản hồi chỉ `JobOutputResponse{id}` (plan §2.4); Hub tự tính sha256 khi `stage`. Header vẫn chỉ ở tải nội bộ R17 (B5) | plan §2.4, rt §9 F3/F8 |
| B9-7 | **Tranh chấp test khoá** A90 | `outputs.int.test.ts:116` `toMatchObject({…, size: body.length})` so với `attRow` (`select *`): cột `size bigint` ⇒ postgres.js trả **chuỗi** `"32"` ⇒ A90 đỏ chỉ vì kiểu (mọi trường khác khớp, 201 + `JobOutputResponse` + file trên đĩa đúng). Không sửa test — đề xuất qc: `size: String(body.length)` hoặc `Number(row.size)` | Không có cách phía code trả `size` dạng số qua `select *` của client test |
| B9-7/TC | A90 `outputs.int.test.ts` (qc) | Phán **test sai** (cột `size bigint` ⇒ chuỗi qua postgres.js): `size: String(body.length)`. Lock: chỉ dòng hash file này | `test-plan-log` "Tranh chấp" TC-5; code sản phẩm không đổi |

## BUILD — B7 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| B7-1 | `dify/dify-upload.ts` | `mapDifyUploadError`, `difyUploadId` (plan-rules §5) + `uploadDifyFile(req, signal, fetch?)` → `{ok, id, status, ms}` / `{ok:false, code, reason, status, detail, ms}` / `{ok:false, code:"ABORTED"}`; multipart `file` (tên `safe_name`, type mime) + `user`; hạn riêng `DIFY_UPLOAD_TIMEOUT_MS = 60 s` ⇒ `UPSTREAM_ERROR`/`upstream`; `signal` người gọi abort ⇒ `ABORTED` (driver quyết `TIMEOUT`/huỷ); 2xx không `id` hợp lệ ⇒ `upstream`; thân lỗi chỉ qua `maskSecret` (`readBodyText` của `dify.client.ts` export dùng lại). Không retry/cache (T8) | P14, plan-errors §4; `DifyClient` 280 dòng |
| B7-2 | `attachments/attachment-dify.ts` | `uploadToDify(deps{storage, fetch?}, {tenantId, file: RunFile}, target, signal)` → kết quả + trace `{mime, size, ms, status?, reason?}`; `difyFileInput(file, id)`. Kho vắng (PL14) / nội dung mất ⇒ ném `AttachmentContentMissing` ⇒ driver `INTERNAL_ERROR` + log error `attachment-content-missing {attachment_id}`. **B8 dùng lại** cho MCP | plan §4; plan-errors §5 |
| B7-3 | `WorkflowInputValue` (`commands/catalog.types.ts`) | Thêm `DifyFileInput` (chỉ driver điền sau upload, không từ tham số/MCP); `maskInputs` gặp object ⇒ `JSON.stringify` (trace MCP B8) | P3 payload `inputs` mang object; `DifyRunRequest.inputs` |
| B7-4 | Sync (`command-driver`) | Upload **trong** step `workflow` (sau `step.started`, sau lấy key R17, trước `runStreaming`) bằng `commands/driver/command-files.ts` `uploadCommandFiles`; hạn `timeout_s` tính cả upload. Lỗi ⇒ `run.failed` mã R22, `reason` (`file_rejected`/`upstream`) truyền `SseWriter.finish` ⇒ hint; trace step = `{code, reason, http_status, upstream, upload}`; thành công ⇒ `Step.upload` giữ `detail.upload` khi đóng step. Log info `dify-upload {run_id, workflow_id, mime, size, ms, status}` | plan §5.6, plan-errors §4–5 |
| B7-5 | Async (`command-async-driver`) | Chỉ khi `p.files` ≠ ∅: Hub lấy key (`AsyncCommandDriverDeps.credentials`, cùng `CredentialService` sync) + upload **trước** `jobs.run` (INSERT job) ⇒ payload `inputs.file` object; `stepDetail` + đóng step giữ `upload`. Upload lỗi/hết hạn/key thiếu ⇒ mở rồi đóng step `workflow` `failed` (trace `upload`), `run.failed`, **không job**. Không file ⇒ hành vi H2a nguyên văn (không lấy key ở Hub) | T7, A108/A109 |
| B7-6 | `runErrorTextFor` | Bảng `UPSTREAM_HINTS` (`Map`: `refused`, `file_rejected`) chỉ áp cho `UPSTREAM_ERROR`; mọi đầu vào cũ giữ kết quả | R41, plan-errors §2 |
| B7-7 | **Chốt câu A116 cho B8** | `tools/call` `{file: 123}` (không phải chuỗi) ⇒ lỗi validate schema H2a `Invalid arguments…` (`validateToolArgs` chạy **trước** `fileArg`; `toolInputSchema(…, true)` khai input `file` = `string`). `TOOL_FILE_TEXT.NOT_ATTACHED` chỉ cho chuỗi không khớp `name`/`id` trong `payload.attachments`; nhánh "không phải chuỗi" của `fileArg` (→ null) chỉ là phòng thủ. Cả hai đều 0 upload | plan §5.6 thứ tự "validate → fileArg"; một nguồn lỗi kiểu như H2a-R20; test A116 nhận cả hai |
| B7-8 | **Báo qc — A103 `upload-slow-65000`** | Với lệnh chuẩn `--timeout 30000`: 11/11 ca `command-file` xanh nhưng `afterAll` báo 1 "(unnamed) hook timed out": `dify.close()` → `mock.close()` (`server.stop(true)`) chờ handler MK `await wait(65000)` (không nghe `req.signal`) còn ~30 s sau khi Hub đã huỷ upload (lệnh `timeout_s = 30` ⇒ `TIMEOUT`). Phía Hub không tránh được (MK ngủ bất kể client). Chạy `--timeout 70000` ⇒ 11 pass / 0 fail. Đề xuất qc: `wait` của MK nghe `req.signal`, hoặc `afterAll` timeout ≥ 70 s | Không sửa test/mock khoá |
| B7-8/TC | A103 `upload-slow-65000` (qc) | Phán **mock sai**: `wait` MK upload nghe `req.signal` (client đóng ⇒ dậy sớm, trả 499 không ai đọc) — giống server thật, không nâng timeout `afterAll`. Lock: chỉ dòng hash `dify-mock.ts`; hồi quy `dify-mock.test` + H2a int + `test:h2a:stack` xanh | `test-plan-log` "Tranh chấp" TC-4; code sản phẩm không đổi |

## BUILD — B8 (backend-lead, 2026-10-05)
| # | Chỗ | Quyết định | Lý do |
|---|---|---|---|
| B8-1 | `mcp.rules.ts` `mcpToolsFor`/`toolInputSchema` | `fileFilter(hasFiles)`: vắng ⇒ H2a nguyên văn (bỏ `file` bắt buộc); `false` ⇒ bỏ **mọi** workflow có input `file`; `true` ⇒ giữ, `toolInputSchema(inputs, true)` (input `file` → `{type:"string", description: (description ?? name) + " (file name in attachments/)"}`, `required` theo input) | P12, R35–R36; test khoá H2a `rules/mcp.test.ts:81` giữ |
| B8-2 | `validateToolArgs` | Input `type=file` nhận **chuỗi** ≤ 64 000 (cùng nhánh `text`); khác chuỗi ⇒ `{ok:false}` ⇒ `Invalid arguments…` (B7-7, A116). Hub luôn truyền `hasFiles` nên job không file không bao giờ thấy/gọi được workflow có `file` (unknown tool) | plan §5.6 "validate → fileArg" |
| B8-3 | `fileArg` | Chuỗi rỗng/không phải chuỗi ⇒ null; khớp `name` chính xác (phân biệt hoa) trước, rồi `id`; `../a.pdf`, `attachments/a.pdf` ⇒ null (không chuẩn hoá đường dẫn) | R37 |
| B8-4 | `mcp.service.ts` | `McpContext.files = payload.attachments ?? []` (đọc lúc `authenticate`); `tools/list` + kiểm tên ở `tools/call` dùng `hasFiles = files ≠ ∅`. Thứ tự `tools/call`: validate H2a → `resolveToolFiles` (sai ⇒ `NOT_ATTACHED`, **không** mở bước `tool`, 0 lời gọi Dify) → cổng `side_effect` (H2a-R21/R22 **không đổi**; A115: xác nhận trước upload) → lấy key (lỗi ⇒ `NOT_CONFIGURED` như H2a, 0 upload) → mở bước `tool` (`detail.inputs` = tên file đã che, không object) → upload tuần tự (`mcp-files.ts`, cùng hạn tool + kết nối `/mcp`, `user = difyUser`) → gọi workflow với `inputs[input] = DifyFileInput` | plan §5.6, plan-errors §3 |
| B8-5 | Lỗi upload | `file_rejected` ⇒ `TOOL_FILE_TEXT.REJECTED`; `NOT_CONFIGURED`/`UPSTREAM_ERROR` ⇒ `TOOL_ERROR_TEXT` H2a; abort ⇒ `TIMEOUT` (hết hạn tool) / `CANCELLED` (kết nối đóng → trả `UPSTREAM_ERROR`, không ai đọc). Bước `tool` `failed` với `code` + `upload` trace (+ `reason`, `http_status`, `upstream` đã che); thành công ⇒ `detail.upload` như lệnh (B7). Không usage khi chưa gọi workflow. Kho không có nội dung ⇒ log `attachment-content-missing` + ném ⇒ bước `INTERNAL_ERROR`, `-32603` (như H2a REVIEW 1 #3) | plan-errors §3–4 |
| B8-6 | Wiring | `McpServiceDeps.storage?` (+ `fetch?` cho test) ← `McpMountDeps.attachments?.storage` (`app.ts` đã rải `...deps`, không sửa `app.ts`); vắng ⇒ tool có file ⇒ `-32603` (PL14) | P14 |
| B8-7 | Kiểm | `mcp-file.int` 7/7 (A110–A116), `agent-job.int` 10/10 (A78), `rules/mcp-h2c` xanh; H2a int 175/175 (`mcp.int` 9, `confirm.int` 11), H1 161/161, H2b 165/165 (lần chạy đầu 1 hook lỗi chập chờn — chạy lại xanh), H2c int 195/195 | — |
