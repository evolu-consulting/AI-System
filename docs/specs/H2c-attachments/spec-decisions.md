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
