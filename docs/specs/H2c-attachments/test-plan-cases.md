# Test plan · H2c-attachments · phụ lục ca R, H, K, M (qc)

Phụ lục của [`test-plan.md`](test-plan.md): §1 hàm thuần (R) · §3 hub-dev (H) + hồi quy khoá (K) · §4 thủ công (M). Int hub-api (A): [`test-plan-int.md`](test-plan-int.md). Python/stack/smoke: [`test-plan-py.md`](test-plan-py.md). Mọi ca R gọi hàm thuần, không DB/đĩa; bảng ca = `test.each` khi nhiều dòng.

## 1. R · Hàm thuần (chữ ký `plan-rules.md`)
### 1.1 `attachment-name.test.ts` (R01–R10) · R01, R02, R13 · HUB-H2c-AC-04 · WRK-BR-07
| ID | Đầu vào → kỳ vọng |
|---|---|
| R01 | `parseFilenameHeader`: `undefined`, `""` → null; `"a%20b.pdf"` → `"a b.pdf"`; `"Ho%C3%A1%20%C4%91%C6%A1n.pdf"` → `"Hoá đơn.pdf"`; ký tự thô ngoài `0x20–0x7E` (`"Hoá.pdf"`, `"a\tb"`) → null; `"%E0%A4%A"` / `"%ZZ"` (`decodeURIComponent` ném) → null; `"%00"` → `"\u0000"` (không lọc ở đây); 1 024 byte UTF-8 sau giải mã → ok, 1 025 → null (đếm byte, không ký tự: 342 × `ạ` = 1 026 byte → null); không trim (`"%20a"` → `" a"`), không NFC (`"a%CC%81"` giữ NFD) |
| R02 | `displayName`: NFD `"a\u0301.txt"` → NFC `"á.txt"`; `"../../etc/passwd.txt"` → `"passwd.txt"`; `"a\\b.txt"` → `"b.txt"`; `"x/"` → `"file"`; bỏ U+0000–001F, U+007F–009F, U+200B–200F, U+202A–202E, U+2066–2069 ở mọi vị trí (`"a\u200Bb.txt"` → `"ab.txt"`, `"\u202Egnp.exe.txt"` → `"gnp.exe.txt"`) |
| R03 | `displayName` trim hai đầu `\s` Unicode và `.` lặp: `"  .. a.md . "` → `"a.md"`; `"\u3000a.md"` → `"a.md"`; `".env.md"` → `"env.md"`; `"   "`, `"..."`, `""` → `"file"`; giữa tên giữ (`"a  b.md"`) |
| R04 | `displayName` > 200 đơn vị UTF-16 (PL12): 300 × `a` + `.pdf` → 196 `a` + `.pdf` (`.length` 200); emoji 2 đơn vị (199 × `😀` + `.md` → 98 × `😀` + `.md`, `.length` 199, không tách cặp surrogate); không có đuôi hợp lệ → ≤ 200 đơn vị đầu; kết quả parse `AttachmentSchema.shape.filename` |
| R05 | `splitExt`: `"a.pdf"` → `{a, pdf}`; `"a.PDF"` giữ hoa; `".env"` → `{".env", null}` (vị trí 0); `"a."` → null; `"a.tar.gz"` → `{"a.tar", "gz"}`; đuôi 11 code point → null; `"a.p-f"` → null; `"a.đ"` → `{a, "đ"}` |
| R06 | `extOf`: `"x.PDF"` → `pdf`, `"x.JPG"` → `jpg`, `"x.jpeg"` → `jpeg`; `"x.exe"`, `"x.html"`, `"x.svg"`, `"x"`, `"x.pdf.exe"` → null; mỗi khoá `ATTACH_ALLOWED` (14) → chính nó; `mimeOf` = `ATTACH_ALLOWED[ext]` (`jpg`/`jpeg` → `image/jpeg`) |
| R07 | `safeName` bảng AC-04 (`safeName(displayName(x))`, plan-rules §1 "Bảng mẫu" nguyên văn): `../../etc/passwd.txt` → `passwd.txt` · `a\b.txt` → `b.txt` · `‮gnp.exe.txt` → `gnp.exe.txt` · `CON.txt` → disp `CON.txt`, safe `CON_.txt` · `.env.md` → `env.md` · `-x.md` → `_-x.md` · `Hoá đơn tháng 9.pdf` giữ nguyên (NFC) · `a<b>\|c.csv` → `a_b_c.csv` · `"   "` → `file` · 300 × `a` + `.pdf` → ≤ 120 byte, kết thúc `.pdf` |
| R08 | `safeName` biên: `con.md`, `Com1.txt`, `LPT9.csv`, `nul` (không đuôi) → thêm `_` vào thân; `COM10.txt`, `CONX.txt` không đổi; `"a__b.md"` → `"a_b.md"` (gộp `_`); `"a$$b.md"` → `"a_b.md"`; 60 × `ạ` + `.md` (183 byte) → ≤ 120 byte, `.md` giữ, không cắt giữa code point; thân rỗng sau xử lý → `file` |
| R09 | `contentDisposition`: `"report.pdf"` → `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`; `"Hoá đơn.pdf"` → `filename="Hoa _on.pdf"` (NFKD bỏ `\p{M}`; `đ` không tách ⇒ ngoài ASCII ⇒ `_`), `filename*=UTF-8''Ho%C3%A1%20%C4%91%C6%A1n.pdf`; `a"b\c.txt` → `filename="a_b_c.txt"`; `it's (1)*.md` → `filename*` có `%27`, `%28`, `%29`, `%2A`; kết quả không chứa CR/LF |
| R10 | `difyFileType`: `image/png`, `image/jpeg`, `image/gif`, `image/webp` → `image`; `application/pdf`, `text/plain`, mime Office → `document` |

### 1.2 `sniff.test.ts` (R11–R16) · R03 · HUB-H2c-AC-03
| ID | Đầu vào → kỳ vọng |
|---|---|
| R11 | `isExecutableHead`: `MZ…`, `7F 45 4C 46…`, `#!/bin/sh`, `EF BB BF 23 21` → true; `M`, `#`, `%PDF-`, `""` → false; `SNIFF_HEAD = 16` |
| R12 | `headOk` theo đuôi: `pdf` `%PDF-1.7` ✓, `%PDF` (4 byte) ✗; `png` 8 byte chữ ký ✓, thiếu 1 byte ✗; `jpg`/`jpeg` `FF D8 FF E0` ✓; `gif` `GIF87a`/`GIF89a` ✓, `GIF88a` ✗; `webp` `RIFF????WEBP` ✓, `RIFF????WAVE` ✗; `docx`/`xlsx`/`pptx` `PK\x03\x04` ✓, `PK\x05\x06` ✗; nhóm chữ → true |
| R13 | `headOk` chéo loại (AC-03): `pdf` + đầu PNG ✗; `png` + `%PDF-` ✗; `pdf` + `MZ` ✗; `txt` + `MZ` ✗ (`isExecutableHead` thắng nhóm chữ); `md` + `#!/bin/sh` ✗; `md` + BOM + `#!` ✗ |
| R14 | `FileInspector` nhị phân: `pdf` push từng byte `%`,`P`,`D`,`F`,`-` rồi phần còn → mọi `push` true, `end` true; đủ 16 byte mới quyết định (push 3 byte đầu PNG cho `pdf` → true tới khi đủ 16 hoặc `end`, rồi false); file 3 byte `%PD` → `end` false; 0 byte → `end` true |
| R15 | `FileInspector` chữ: `txt` UTF-8 (`"Xin chào"`) ✓; BOM `EF BB BF` ✓ (`.csv` AC-03); byte `00` ở chunk 2 → `push` false và mọi lần sau false; UTF-8 sai (`C3 28`) → false; ký tự 3 byte cắt giữa hai chunk (`E1 BA` \| `A1`) → true; cắt ở cuối file (`E1 BA` rồi `end`) → `end` false; UTF-16 LE `FF FE 61 00` → false |
| R16 | Bảng AC-03 (plan-rules §2 "Mẫu AC-03"): `.exe` → `extOf` null · `MZ` đuôi `.pdf` ✗ · `.pdf` chứa PNG ✗ · `.html`/`.svg` → `extOf` null · `.txt` có `00` ✗ · `#!/bin/sh` `.md` ✗ · `.docx` ✓ · `.csv` BOM ✓ · `.JPG` (`FF D8 FF E0`) ✓ · `.txt` UTF-16 LE ✗ |

### 1.3 `run-files.test.ts` (R17–R24) · R14, R15, R24 · WRK-FR-11, WRK-FR-18
| ID | Đầu vào → kỳ vọng |
|---|---|
| R17 | `pickRunFiles` sắp: tin hiện tại (3 file, `position` 2,0,1 lẫn lộn) trước, theo `position`; tin cũ `messageCreatedAt` giảm dần, hoà → `messageId` giảm dần; `kind:"command"` → chỉ hàng của `currentMessageId` (bỏ tin cũ dù còn chỗ) |
| R18 | `pickRunFiles` cắt: 12 hàng → 10 đầu; tổng: 5 × 20 MiB (= 100 MiB đúng) → 5; hàng thứ 3 làm tổng > 100 MiB → dừng ở 2 dù hàng 4 nhỏ (không nhảy cóc); `RUN_FILES_MAX = 10`, `RUN_FILES_MAX_BYTES = 104_857_600`; `[]` → `[]` |
| R19 | `jobFileNames`: `[a.pdf, a.pdf, a.pdf]` → `[a.pdf, a-2.pdf, a-3.pdf]`; `[A.pdf, a.pdf]` → `[A.pdf, a-2.pdf]` (không phân biệt hoa); `[a-2.pdf, a.pdf, a.pdf]` → `[a-2.pdf, a.pdf, a-3.pdf]`; không đuôi `[x, x]` → `[x, x-2]`; tên 120 byte trùng → `-2` vẫn ≤ 120 byte (bớt thân), giữ đuôi |
| R20 | `jobAttachments([])` → `[]`; 2 file → `{id, name (đã khử trùng), mime, size, sha256}` đúng thứ tự, parse `JobAttachmentSchema`; `fileSizeKb`: 1 → 1, 1024 → 1, 1025 → 2, 20 971 520 → 20 480 |
| R21 | `orchestratorFilesBlock([])` → null; 2 mục → nguyên văn `"<attachments>\n- hoadon.pdf (application/pdf, 1024 KB)\n- a.md (text/markdown, 1 KB)\n</attachments>"`; `orchestratorPrompt` có `attachments` → khối nằm **giữa** `</steps_left>` và `<message>`; vắng / `[]` → chuỗi **===** kết quả H1 cùng đầu vào |
| R22 | `agentFilesBlock` → nguyên văn plan-rules §3 (câu "The user attached these files. They are in your working directory; read them by relative path:" + `- attachments/<name> (<mime>, <n> KB)`); `[]` → null |
| R23 | `withOutHint("", 8000)` → `{text: OUT_HINT, dropped:false}`; `("S", 8000)` → `"S\n\n" + OUT_HINT`; `text.length` (UTF-16) = `max` → giữ; system có emoji đếm 2 đơn vị; `max + 1` → `{text:"S…", dropped:true}`; `OUT_HINT` nguyên văn plan-rules §3 |
| R24 | `buildJobPayload` (`runner.rules`): `attachments` vắng / `[]` → `toEqual` payload H2b (không khoá `attachments`); 2 mục → khoá `attachments` đúng mảng, parse `AgentCliJobSchema` |

### 1.4 `attach-limits.test.ts` (R25–R30) · R04, R06, R29 · HUB-H2c-AC-14, AC-15
| ID | Đầu vào → kỳ vọng |
|---|---|
| R25 | `overQuota(0, 1, 1)` false; `(1, 1, 1)` true; `(4, 1, 5)` false; `(5_368_709_119, 1, 5_368_709_120)` false; `+2` true |
| R26 | `parseAttachEnv` ok: `{local, "/srv/a"}`, `linux` → `{driver:"local", dir:"/srv/a", tenantMaxBytes:5_368_709_120, sweepS:600}`; `win32` + `"C:\data\a"` ok; `linux` + `"C:\data"` → ném (không tuyệt đối theo `path.posix`); `HUB_ATTACH_TENANT_MAX_BYTES="20971520"` ok, `HUB_ATTACH_SWEEP_S="10"`/`"86400"` ok |
| R27 | `parseAttachEnv` ném: driver vắng / `"s3"` / `"LOCAL"`; dir vắng / `"rel/dir"` / `"./x"`; max `"1048576"` (< 20 MiB), `"1e9"`, `"5.5"`, `"-1"`, `"9007199254740992"`; sweep `"9"`, `"86401"`, `"60.5"`, `"abc"`; **message lỗi không chứa giá trị** env (assert `not.toContain`) |
| R28 | `storageKey(t, id)` = `t + "/" + id`; `isStorageKey`: uuid thường/uuid → true; hoa → false; `"../x"`, `"t/../id"`, `"t/id/x"`, `"t\\id"`, `""` → false |
| R29 | `keyUnder("/r", key, "/")` → `"/r/<t>/<id>"`; `keyUnder("C:\\r", key, "\\")` → `"C:\\r\\<t>\\<id>"`; key sai (`"../x"`) → null |
| R30 | `orphanCandidate`: `UNBOUND_TTL_MS = 86_400_000`, `ORPHAN_AGE_MS = 3_600_000`, `SWEEP_BATCH = 500`; `.part` tuổi 1 h + 1 ms → true, 1 h đúng → false; file thường không trong `live` tuổi > 1 h → true; trong `live` → false dù cũ; < 1 h → false |

### 1.5 `command-input-h2c.test.ts` (R31–R34) · R20 · HUB-FR-12 · ADM-FR-21 · K10
| ID | Đầu vào → kỳ vọng |
|---|---|
| R31 | Hồi quy: mọi đầu vào H2a không `attachment` → `toEqual` kết quả H2a, không khoá `files`; `attachment: null` ≡ vắng |
| R32 | Input `file` bắt buộc ← `attachment`: có `{id:X}` → ok, `files:[{input:"file", attachmentId:X}]`, `inputs` **không** có `file`; vắng → `missing:["file"]`; tuỳ chọn + vắng → ok, không `files`; hai input `file` cùng map → cả hai nhận **cùng** X (T9) |
| R33 | Lệch map → `invalid` **bất kể có giá trị** (P13, K10): `file` ← `arg` → `invalid` nhãn = tên tham số (H2a-R06); `file` ← `selection` → `invalid`; input `text` ← `attachment` → `invalid` (có hay không có file) |
| R34 | Thứ tự `missing`/`invalid` như H2a (`ordered`) khi lẫn lỗi file + lỗi arg; `file` không map + bắt buộc → `missing` (như H2a) |

### 1.6 `mcp-h2c.test.ts` (R35–R38) · R23 · HUB-FR-50 · K10
| ID | Đầu vào → kỳ vọng |
|---|---|
| R35 | `mcpToolsFor` `hasFiles` vắng → `toEqual` H2a (bỏ workflow có `file` bắt buộc; `anh-tuy-chon` có mặt, schema không có `img`); `false` → bỏ **mọi** workflow có input `file` (cả `anh-tuy-chon`); `true` → giữ cả `hoadon-file`, `anh-tuy-chon` |
| R36 | `toolInputSchema(inputs, true)`: `file` → `{type:"string", description:"Hoá đơn PDF (file name in attachments/)"}`; không mô tả → `"<name> (file name in attachments/)"`; `required` theo `i.required`; `withFiles` vắng → như H2a |
| R37 | `fileArg`: `"a.pdf"` khớp `name` → mục đó; khớp `id` → mục; `name` của mục 1 trùng `id` của mục 2 → ưu tiên `name`; `"A.pdf"` (khác hoa) → null; `""`, `123`, `null`, `["a.pdf"]`, `"../a.pdf"` → null; `files=[]` → null |
| R38 | `TOOL_FILE_TEXT` nguyên văn `{NOT_ATTACHED:"This file is not attached to this message.", REJECTED:"Dify rejected this file (type or size)."}` |

### 1.7 `dify-upload.test.ts` · `run-errors-h2c.test.ts` (R39–R41) · R22
| ID | Đầu vào → kỳ vọng |
|---|---|
| R39 | `mapDifyUploadError`: 401/403/404 → `{NOT_CONFIGURED, upstream}`; 413, 415 → `{UPSTREAM_ERROR, file_rejected}`; 400 `{code:"file_too_large"}` / `{code:"unsupported_file_type"}` → `file_rejected`; 400 `{code:"invalid_param"}`, 500, 503 → `{code: mapDifyHttpError(s), reason:"upstream"}` |
| R40 | `difyUploadId`: `{id:"abc"}` → `"abc"`; `{id:""}`, `{id: "x".repeat(101)}`, `{id:1}`, `{}`, `null`, `"abc"` → null; 100 ký tự → ok |
| R41 | `runErrorTextFor("UPSTREAM_ERROR", "vi", "file_rejected").hint` = `"Dify không nhận file này (loại hoặc kích thước)."`, `en` = `"Dify rejected this file (type or size)."`, `message` = câu `UPSTREAM_ERROR` H1; `("NOT_CONFIGURED", l, "file_rejected")` = `runErrorText`; reason `refused` (H2b) và `null` giữ kết quả cũ (7 mã × 2 locale) |

### 1.8 `messages-h2c.test.ts` (R42–R43) · R12
| ID | Đầu vào → kỳ vọng |
|---|---|
| R42 | `toMessage(m, run, responder?)` không `refs` / `refs=[]` → `toEqual` H2b, `"attachments" in msg` false; `refs` 2 mục → khoá `attachments` đúng thứ tự, parse `MessageSchema` (user và assistant) |
| R43 | `toAttachmentRef({…, purgedAt:null})` → `available:true`; `purgedAt: Date` → `false`; `Object.keys` = `{id, filename, mime, size, available}` |

### 1.9 `contracts-h2c.test.ts` (R44–R49) · spec §3
| ID | Ca |
|---|---|
| R44 | Hằng: `ATTACH_MAX_BYTES = 20_971_520`, `ATTACH_PER_MESSAGE_MAX = 10`, `ATTACH_FILENAME_MAX = 200`, `ATTACH_FILENAME_HEADER_MAX_BYTES = 1024`, `FILENAME_HEADER = "X-Filename"`, `ATTACH_ALLOWED` đúng 14 khoá/mime (Q1); `CHAT_ATTACHMENT_ERRORS` = `{ATTACHMENT_NOT_FOUND:404, ATTACHMENT_QUOTA_EXCEEDED:409, ATTACHMENT_TOO_LARGE:413, ATTACHMENT_TYPE_NOT_ALLOWED:415}`; `CHAT_API_ERRORS`, `CHAT_RUN_ERROR_CODES`, `CHAT_EVENT_NAMES` **không** chứa mã mới (chỉ thêm, P2) |
| R45 | `AttachmentSchema`: thừa khoá → lỗi; `size` 0 / 20 971 521 → lỗi, 1 / max ok; `filename` 201 → lỗi; mime ngoài `ATTACH_MIMES` → lỗi; `AttachmentDetailSchema` cần `available`; `AttachmentNotFoundDetailsSchema` `ids` 0 / 11 → lỗi |
| R46 | `SendMessageRequestSchema`: `{content:"hi"}` → `toEqual({content:"hi"})` (không thêm khoá); `attachment_ids` 1/10 ok; 0 / 11 / trùng / không uuid → lỗi; khoá lạ vẫn lỗi (`strictObject`). `MessageSchema`: `attachments:[]` → lỗi (min 1); vắng ok; 11 → lỗi |
| R47 | Hub: `JobAttachmentSchema` `name` hợp lệ (`Hoá đơn.pdf`, `a-2.pdf`, `_-x.md`) ok; `../x`, `a/b`, `a\\b`, `.env`, `-x`, `""`, NUL, 121 ký tự → lỗi; `sha256` hoa / 63 ký tự → lỗi; `AgentCliJob` thiếu `attachments` ok, 11 → lỗi |
| R48 | `ALLOWED_TOOLS` = `[Read, Grep, Glob, Write]` (PL9), `AgentCliJob.allowed_tools` `[Read, Write]` ok, `Edit` / 5 phần tử → lỗi; `buildJobPayload` agent `runtime_options.allowed_tools` ∋ `Write` → có `Write`, vắng → `[Read, Grep]` (hồi quy H1 A27); `JOB_FAIL_REASONS.at(-1) === "attachment"`, độ dài 15; `JobResultEventSchema` `outputs` vắng ok, `[]` / 6 → lỗi; `DifyFileInputSchema` `transfer_method:"remote_url"` → lỗi, `type:"video"` → lỗi; `WorkflowInputValue` nhận object file |
| R49 | Fixture `packages/contracts/fixtures/hub/{valid,invalid}` mới (plan §2.2: 5 valid, 8 invalid) parse đúng chiều; fixture cũ vẫn valid; `hub-internal` `JobOutputResponseSchema{id}` strict, `CONTENT_SHA256_HEADER = "X-Content-SHA256"`, `HUB_INTERNAL_ERRORS` ∋ `NOT_FOUND:404`, `ATTACHMENT_*` 409/413/415 |

## 3. H · hub-dev · K · hồi quy khoá (chạy lại, không sửa)
| ID | Bộ | Lý do |
|---|---|---|
| H01 | `H2c/hubdev/attach.hubdev.test.ts` (`needsDev`, HUB_URL/AUTH_URL): `lan` `POST /attachments` `.txt` 10 B → 201; gửi tin `#fake:files` + id → SSE `run.finished` (hub-dev Runtime `fake`) hoặc, khi `HUB_DEV_RUNTIME=none`, chỉ 200 SSE `run.started`; `GET /attachments/:id/content` đúng byte | MK env `HUB_ATTACH_*` hub-dev |
| K01 | `bun test packages/contracts/src/chat` (`entities.test.ts:142`), `tests/acceptance/C1/**` | P2 chỉ thêm |
| K02 | `test:contract:chat` 41 pass (hub-dev, AC-16) — `FORBIDDEN_KEYS` không trùng khoá mới | R30 |
| K03 | `tests/acceptance/H1/**` (A14/A16 prompt nguyên văn, A15/A37 `lock-order`, `concurrency`, A48–A51, stack) | P8, P10, P11 |
| K04 | `tests/acceptance/H2a/**` (`rules/mcp.test.ts:81`, `command-input.test.ts:103`, `runner`, `command-run`, `async`, `mcp`, `confirm`, `dify-errors`, `credential`, stack) | P12, P13, K10, MK-U |
| K05 | `tests/acceptance/H2b/**` (`direct.int:305`, `delta`, `compat`, `run-limit`, `contracts-h2b`, stack, hubdev) | B0 TD #52, P10 |
| K06 | `apps/agent-runtime/tests/acceptance/**` H1/H2a/H2b + `test_contracts_hub.py` (`KEYS` 8) + `tests/support/test_{dify,mcp}_mock.py` | PY-00 `hub_http`, C2 |
| K07 | `tests/acceptance/{M1..M4,ADM-NFR-06}` | Admin không đổi |
| K08 | typecheck `@ai/chat-web`, `@ai/mocks` | P2 |
| K09 | `depcruise`, `check:size --all`, `check:fn` | P18, P19 |
| K10 | `packages/db` int (`hub-h2c.int.test.ts` D1: plan-db §5) | `0007` idempotent |
| K11 | `bun test tools/hub-dev` (`dify-mock.test.ts` cũ + ca upload) | MK-U |
| K12 | `bun run test:smoke:live` không `HUB_LIVE` → exit 0 | I2 |

## 4. M · Thủ công
| ID | Checklist |
|---|---|
| M01 | `smoke.md` (I2): SM1–SM3 + Dify thật (app vô hại có input `file` qua `GET /parameters`; không có ⇒ ghi "bỏ qua"); không chép key |
| M02 | `docs/guides/hub-dev.md` có `UPLOAD_FILE_SIZE_LIMIT` (K4) và `HUB_ATTACH_*` |
| M03 | PRODUCTION-NOTES (I3): quét virus (T15), ổ chia sẻ (K1), giới hạn Dify (K4), sao lưu `HUB_ATTACH_DIR`, TD #59 |
