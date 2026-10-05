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
