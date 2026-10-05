# Plan · H2c · Hàm thuần TS — chữ ký chốt (phụ lục `plan.md` §6)

qc viết test trước theo bảng này (unit, không DB/đĩa). Hàm cũ bị test khoá import (`buildInputs`, `mcpToolsFor`, `toolInputSchema`, `buildJobPayload`, `orchestratorPrompt`, `runErrorTextFor`, `toMessage`) **giữ chữ ký, giữ kết quả** với đầu vào cũ: trường mới là **tuỳ chọn**, khoá mới trong kết quả **vắng** khi rỗng. Python: `plan-runtime.md` §4. Hằng contract: `plan.md` §2.

## 1. Tên, loại, header — `attachments/attachment.rules.ts`
| Chữ ký | Luật chính xác |
|---|---|
| `parseFilenameHeader(raw: string \| undefined): string \| null` | `null` khi: vắng/rỗng; có ký tự ngoài `0x20–0x7E`; `decodeURIComponent` ném; kết quả rỗng; > `ATTACH_FILENAME_HEADER_MAX_BYTES` (1 024) byte UTF-8. Không trim, không NFC (việc của `displayName`) |
| `displayName(decoded: string): string` | (1) `normalize("NFC")` (2) phần sau `/` hoặc `\` cuối (3) bỏ code point: U+0000–U+001F, U+007F–U+009F, U+200B–U+200F, U+202A–U+202E, U+2066–U+2069 (4) bỏ ở **hai đầu** mọi ký tự `\s` (Unicode) hoặc `.` (lặp tới hết) (5) rỗng → `"file"` (6) > 200 **đơn vị UTF-16** (`.length`, khớp zod `max(200)` — PL12) → giữ `.<đuôi>` (`splitExt`), cắt thân theo code point (không tách cặp surrogate) tới khi tổng ≤ 200; không đuôi → cắt đầu ≤ 200 |
| `splitExt(name: string): {stem: string; ext: string \| null}` | `.` cuối ở vị trí > 0 và phần sau là 1–10 code point khớp `^[\p{L}\p{N}]+$` → `{stem: trước, ext: sau}` (giữ hoa thường); khác → `{stem: name, ext: null}` |
| `extOf(filename: string): AttachExt \| null` | `splitExt(filename).ext?.toLowerCase()` ∈ khoá `ATTACH_ALLOWED`; khác → `null` |
| `mimeOf(ext: AttachExt): AttachMime` | `ATTACH_ALLOWED[ext]` |
| `safeName(filename: string): string` | Đầu vào = `displayName`. (1) mỗi code point ∉ `[\p{L}\p{N} ._-]` → `_` (2) gộp `_` liên tiếp (3) bắt đầu `.` hoặc `-` → thêm `_` đầu (4) `splitExt`; `stem.toUpperCase()` ∈ {`CON`,`PRN`,`AUX`,`NUL`,`COM1`…`COM9`,`LPT1`…`LPT9`} → `stem + "_"` (5) > 120 byte UTF-8 → giữ `.<ext>`, bớt code point cuối của thân tới khi vừa (6) thân rỗng → `file` |
| `contentDisposition(filename: string): string` | `attachment; filename="<a>"; filename*=UTF-8''<p>` — `a` = `normalize("NFKD")`, bỏ `\p{M}`, ký tự ngoài `0x20–0x7E` hoặc `"` `\` → `_`; `p` = `encodeURIComponent` rồi mã thêm `'` `(` `)` `*` (`%27 %28 %29 %2A`) |
| `difyFileType(mime: AttachMime): "image" \| "document"` | `mime.startsWith("image/")` → `image` |

Bảng mẫu (AC-04, `safeName(displayName(x))`): `../../etc/passwd.txt` → disp `passwd.txt`, safe `passwd.txt` · `a\b.txt` → `b.txt` · `‮gnp.exe.txt` → disp `gnp.exe.txt` (đuôi `txt`) · `CON.txt` → disp `CON.txt`, safe `CON_.txt` · `.env.md` → disp `env.md` · `-x.md` → safe `_-x.md` · `Hoá đơn tháng 9.pdf` → giữ nguyên (NFC) · `a<b>|c.csv` → safe `a_b_c.csv` · `"   "` → `file` · 300 × `a` + `.pdf` → disp 196 `a` + `.pdf`; safe ≤ 120 byte giữ `.pdf`.

## 2. Kiểm nội dung — `attachments/sniff.rules.ts`
| Chữ ký | Luật |
|---|---|
| `SNIFF_HEAD = 16` · `isExecutableHead(head: Uint8Array): boolean` | bắt đầu `4D 5A` (`MZ`) ∨ `7F 45 4C 46` (ELF) ∨ `23 21` (`#!`); bỏ BOM `EF BB BF` đầu rồi xét lại `#!` |
| `headOk(ext: AttachExt, head: Uint8Array): boolean` | `head` = ≤ 16 byte đầu (cả file nếu ngắn hơn). `isExecutableHead` → false. `pdf`: `%PDF-` · `png`: `89 50 4E 47 0D 0A 1A 0A` · `jpg`/`jpeg`: `FF D8 FF` · `gif`: `GIF87a`/`GIF89a` · `webp`: byte 0–3 `RIFF` ∧ 8–11 `WEBP` · `docx`/`xlsx`/`pptx`: `50 4B 03 04` · nhóm chữ (`txt`,`md`,`csv`,`xml`,`json`): true (kiểm ở `FileInspector`). Ngắn hơn chữ ký → false |
| `class FileInspector(ext: AttachExt)` · `push(chunk: Uint8Array): boolean` · `end(): boolean` | `false` = từ chối (415). Gom ≤ 16 byte đầu; khi đủ 16 hoặc ở `end` → `headOk`. Nhóm chữ: mỗi chunk — có byte `0x00` → false; `TextDecoder("utf-8", {fatal: true})` `decode(chunk, {stream: true})` ném → false; `end`: `decode()` ném (chuỗi cắt dở) → false. BOM cho phép. Đã false thì mọi lần gọi sau false. 0 byte → `end()` = true (luật thân rỗng ở service: 400) |

Mẫu AC-03: `.exe` → `extOf` null · `MZ…` đuôi `.pdf` → false · `.pdf` chứa PNG → false · `.html`/`.svg` → `extOf` null · `.txt` có `00` → false · `#!/bin/sh` đuôi `.md` → false · `.docx` (`PK\x03\x04`) → true · `.csv` có BOM → true · `.JPG` (`FF D8 FF E0`) → true · `.txt` UTF-16 LE (`FF FE`) → false (không UTF-8 hợp lệ).

## 3. Tập file run, tên trong job, prompt — `attachments/run-files.rules.ts`
| Chữ ký | Luật |
|---|---|
| `RUN_FILES_MAX = 10` · `RUN_FILES_MAX_BYTES = 104_857_600` | R14, T3 |
| `type FileRow = {id; messageId; messageCreatedAt: Date; position: number; safeName; mime: AttachMime; size: number; sha256: string}` | hàng `plan-db` §2.3 (chỉ `available`) |
| `pickRunFiles(rows: readonly FileRow[], o: {currentMessageId: string; kind: "orchestrated" \| "direct" \| "command"}): FileRow[]` | `command` → chỉ hàng của `currentMessageId`. Sắp: tin hiện tại trước; còn lại `messageCreatedAt` giảm dần, hoà → `messageId` giảm dần; trong tin `position` tăng. Lấy lần lượt; **dừng** ở hàng thứ 11 hoặc ở hàng đầu tiên làm tổng > 100 MiB (không nhảy cóc) |
| `jobFileNames(names: readonly string[]): string[]` | Giữ thứ tự; so **không phân biệt hoa** (`toLowerCase`) với các tên đã nhận; trùng → thử `stem-2.ext`, `stem-3.ext`… (`splitExt`; không đuôi → `name-2`) tới khi chưa có; > 120 byte → bớt thân (như `safeName` bước 5) |
| `jobAttachments(files: readonly RunFile[]): JobAttachment[]` | `RunFile = {id; name /*safe_name*/; mime; size; sha256}` → `{id, name: jobFileNames(...)[k], mime, size, sha256}`; mảng rỗng → `[]` (người gọi **không** ghi khoá `attachments`) |
| `fileSizeKb(size: number): number` | `Math.max(1, Math.ceil(size / 1024))` |
| `orchestratorFilesBlock(items: readonly {name; mime; size}[]): string \| null` | rỗng → `null`; khác → `"<attachments>\n" + items.map(i => "- " + i.name + " (" + i.mime + ", " + fileSizeKb(i.size) + " KB)").join("\n") + "\n</attachments>"` (R15) |
| `agentFilesBlock(items: readonly {name; mime; size}[]): string \| null` | rỗng → `null`; khác → `"<attachments>\nThe user attached these files. They are in your working directory; read them by relative path:\n" + items.map(i => "- attachments/" + i.name + " (" + i.mime + ", " + fileSizeKb(i.size) + " KB)").join("\n") + "\n</attachments>"` — prompt job = `prompt + "\n\n" + block` |
| `OUT_HINT` · `withOutHint(system: string, max: number): {text: string; dropped: boolean}` | `OUT_HINT = "To return files to the user, write them directly in the out/ directory (at most 5 files, 20 MiB each)."`; `text = system ? system + "\n\n" + OUT_HINT : OUT_HINT`; độ dài `text.length` (đơn vị UTF-16, khớp zod `SYSTEM_PROMPT_MAX`) > `max` → `{text: system, dropped: true}`. Chỉ gọi khi job agent có `Write` (PL9) |
| `PromptInput.attachments?: readonly {name; mime; size}[]` (`orchestrator/orchestrator.prompt.ts`) | `orchestratorPrompt`: có ≥ 1 → chèn `orchestratorFilesBlock` giữa `<steps_left>` và `<message>`; vắng/rỗng → chuỗi **y hệt** H1 |
| `PayloadInput.attachments?: readonly JobAttachment[]` (`runner/runner.rules.ts`, kiểu vào thật của `buildJobPayload`) | ≥ 1 → payload có khoá `attachments`; vắng/rỗng → payload **y hệt** H2b (không khoá) |

## 4. Hạn mức, env, storage, sweeper
| File | Chữ ký |
|---|---|
| `attachments/attachment.rules.ts` | `overQuota(used: number, add: number, max: number): boolean` (`used + add > max`) |
| `attachments/attach-env.rules.ts` | `parseAttachEnv(e: {HUB_ATTACH_DRIVER?; HUB_ATTACH_DIR?; HUB_ATTACH_TENANT_MAX_BYTES?; HUB_ATTACH_SWEEP_S?}, platform: NodeJS.Platform): {driver: "local"; dir: string; tenantMaxBytes: number; sweepS: number}` — ném `Error` (message không chứa giá trị env) khi: driver vắng hoặc ≠ `local`; dir vắng hoặc `!path.isAbsolute` (theo `platform`: `win32` dùng `path.win32`); `tenantMaxBytes` không phải số nguyên thập phân hoặc < `ATTACH_MAX_BYTES` hoặc > `Number.MAX_SAFE_INTEGER` (vắng → 5 368 709 120); `sweepS` không nguyên hoặc ∉ 10–86 400 (vắng → 600) |
| `attachments/storage.ts` | `storageKey(tenantId: string, id: string): string` (= `tenantId + "/" + id`) · `isStorageKey(k: string): boolean` (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<uuid>$`, chữ thường) · `keyUnder(root: string, key: string, sep: "/" \| "\\"): string \| null` (`!isStorageKey` → null; nối `root + sep + tenant + sep + id`) — `realpath` + so gốc ở driver (I/O) |
| `attachments/storage.local.ts` | `createLocalStorage(o: {dir: string; platform?: NodeJS.Platform}): Promise<AttachmentStorage>` (L8) — tạo `dir` nếu thiếu (0700 khi không `win32`), ghi thử; lỗi ⇒ ném (server thoát ≠ 0) |
| `attachments/sweeper.ts` | `sweepOnce(d: {db: Db; storage: AttachmentStorage; now: Date; log?: Logger}): Promise<{expired: number; purged: number; orphans: number; skipped: boolean}>` (L1, PL11 — test int gọi thẳng với `hub.db`) · `startAttachmentSweeper(d & {everyMs; signal?})` |
| `attachments/sweeper.rules.ts` | `UNBOUND_TTL_MS = 86_400_000` · `ORPHAN_AGE_MS = 3_600_000` · `SWEEP_BATCH = 500` · `orphanCandidate(e: {key: string; partial: boolean; mtimeMs: number}, nowMs: number, live: ReadonlySet<string>): boolean` = `nowMs − e.mtimeMs > ORPHAN_AGE_MS` ∧ (`e.partial` ∨ `!live.has(e.key)`) |

Interface (`attachments/storage.ts`, driver `storage.local.ts`; test int):
```ts
type ChunkInspector = { push(chunk: Uint8Array): boolean; end(): boolean };
type Staged = { size: number; sha256: string; commit(): Promise<void>; discard(): Promise<void> };
type StoredEntry = { key: string; partial: boolean; size: number; mtimeMs: number };
interface AttachmentStorage {
  readonly driver: "local";
  stage(key: string, body: ReadableStream<Uint8Array>, o: { maxBytes: number; inspect?: ChunkInspector }): Promise<Staged>;
  open(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>; // null = không có file
  blob(key: string, type: string): Promise<Blob | null>;
  remove(key: string): Promise<void>;                 // xoá cả `<key>` và `<key>.part`; không có = ok
  list(o: { after: string | null; limit: number }): Promise<StoredEntry[]>; // sắp theo key; `partial` = `.part`
}
class StorageTooLarge extends Error {} · class StorageRejected extends Error {} · class StorageKeyError extends Error {}
```
`stage`: key sai/`realpath` thư mục tenant ngoài gốc → `StorageKeyError`; mở `<key>.part` cờ `wx` + `0o600` (thư mục tenant `mkdir 0o700` recursive); đếm byte > `maxBytes` → huỷ đọc, xoá `.part`, `StorageTooLarge`; `inspect.push/end` false → xoá, `StorageRejected`; xong → `fsync`, đóng. `commit` → `rename(.part, key)`; `discard` → `rm .part` (lỗi nuốt + log ở service).

## 5. Lệnh, MCP, lỗi run
| File | Chữ ký |
|---|---|
| `commands/command-input.rules.ts` (+) | `BuildInputsInput` + `attachment?: {id: string} \| null` · kết quả ok + `files?: {input: string; attachmentId: string}[]` (**vắng** khi không input `file` nào nhận file). Mỗi input theo schema: (a) `type=file` ∧ map ∃ ∧ `source ≠ attachment` → `invalid` (nhãn = tên input; `arg` → tên tham số như H2a-R06); (b) `type≠file` ∧ `source = attachment` → `invalid`; (c) `type=file` ∧ `source = attachment`: `attachment` có → `files.push({input, attachmentId})`, không có → `required` ⇒ `missing`, không ⇒ bỏ; (d) còn lại như H2a. `type=file` không map → như H2a (null ⇒ `missing` nếu `required`). Thứ tự `missing`/`invalid` như H2a (`ordered`) |
| `mcp/mcp.rules.ts` (+) | `McpToolsInput` + `hasFiles?: boolean` · `mcpToolsFor(i)`: `hasFiles === undefined` → **H2a nguyên văn**; `false` → bỏ mọi workflow có input `type=file`; `true` → giữ, `inputSchema = toolInputSchema(w.inputSchema, true)` · `toolInputSchema(inputs, withFiles = false)`: `withFiles` → input `file` = `{type: "string", description: (i.description ?? i.name) + " (file name in attachments/)"}`, `required` theo `i.required` · `fileArg(v: unknown, files: readonly JobAttachment[]): JobAttachment \| null` (chuỗi; khớp `name` chính xác trước, rồi `id`; khác → null) · `TOOL_FILE_TEXT = {NOT_ATTACHED: "This file is not attached to this message.", REJECTED: "Dify rejected this file (type or size)."}` |
| `runner/job/job-agent-runner.ts` | `agentToolKeys(ids, catalog, hasFiles?: boolean)` → truyền `hasFiles` cho `mcpToolsFor` |
| `dify/dify-upload.ts` | `mapDifyUploadError(status: number, body: unknown): {code: "NOT_CONFIGURED" \| "UPSTREAM_ERROR"; reason: "file_rejected" \| "upstream"}` — 401/403/404 → `NOT_CONFIGURED`/`upstream`; 413, 415, hoặc `body.code` ∈ {`file_too_large`, `unsupported_file_type`} → `UPSTREAM_ERROR`/`file_rejected`; khác → `mapDifyHttpError(status)`/`upstream` · `difyUploadId(body: unknown): string \| null` (`body.id` chuỗi 1–100) |
| `runs/run-errors.ts` (+) | `runErrorTextFor(code, locale, reason)`: thêm `code="UPSTREAM_ERROR" ∧ reason="file_rejected"` → hint `plan-errors` §2; mọi đầu vào cũ giữ kết quả |
| `conversations/conversations.rules.ts` (+) | `toMessage(m, run, responder?, refs?: readonly AttachmentRef[])` — `refs` ≥ 1 → khoá `attachments`; vắng/rỗng → không khoá · `toAttachmentRef(r: {id; filename; mime; size; purgedAt: Date \| null}): AttachmentRef` (`available = purgedAt === null`) |
