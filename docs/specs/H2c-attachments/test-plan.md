# Test plan · H2c-attachments (qc)

Chế độ **TEST-PLAN** · 2026-10-05. Chưa có file test, chưa khoá; viết + "đỏ đúng lý do" sau Gate (§8), rồi Q2 → Q-PU → Q3 như H2b. Bảng ca: hàm thuần (R), hub-dev (H), hồi quy khoá (K), thủ công (M) → [`test-plan-cases.md`](test-plan-cases.md); int hub-api (A, PF) → [`test-plan-int.md`](test-plan-int.md); Python (P), stack (S), smoke (SM) → [`test-plan-py.md`](test-plan-py.md); nhật ký §10 → [`test-plan-log.md`](test-plan-log.md).
"Đúng" = spec §2 (H2c-R01…R30), §8 (AC-H03 vế đính kèm + HUB-H2c-AC-01…17); chữ ký `plan-rules.md`; câu chữ/log `plan-errors.md`; SQL `plan-db.md` §2–4; luồng `plan.md` §5; Runtime `plan-runtime.md` §3–6, §9 (F1–F15); chốt PL1–PL8 (`spec-decisions.md`). BA chỉ ở mã được trỏ.

## 1. Quy ước
Như H2b §1 (tên test, hộp đen, chờ không `sleep`, cấm `skip/only/todo`), thêm:

| Mục | Quy ước H2c |
|---|---|
| Tên test | TS `"<mã BA> · <ID> · mô tả [H2c-Rxx · HUB-H2c-AC-yy]"` — **mã BA đứng đầu** (`trace --check` hiện đỏ đúng `HUB-FR-44` thiếu test); Python `test_<mã_snake>_…` + docstring mã (`"""WRK-FR-11 · P20 · …"""`) |
| Mã đầu tên | upload/lưu/gắn/xem/vòng đời → `HUB-FR-44`; cách ly/404 đồng nhất/nội bộ → `HUB-FR-75`; command file → `HUB-FR-12` (+ `ADM-FR-21` ở ca map); MCP file → `HUB-FR-50`; Runtime tải/sandbox → `WRK-FR-11`, `WRK-BR-06`, `WRK-BR-07`; `out/` → `WRK-FR-18`; điều phối → `AC-H03` |
| Loại | **R** unit TS · **A** int hub-api (DB/Redis thật, `HUB_ATTACH_DIR` tạm mỗi file, `ScriptRuntime` XADD tay, token job giả `_h2a2.ts`, MK) · **P** Python (unit thuần + int Runtime thật `fake-cli` + mock Hub file) · **S** stack (Hub thật + Runtime container + MK) · **H** hub-dev · **K** khoá có sẵn · **M** thủ công · **SM** smoke `HUB_LIVE=1` · **PF** perf (không chặn) |
| Vị trí | R `tests/acceptance/H2c/rules/*.test.ts` · A `tests/acceptance/H2c/*.int.test.ts` · PF `tests/acceptance/H2c/perf.perf.int.test.ts` · S `tests/acceptance/H2c/stack/*.stack.test.ts` · H `tests/acceptance/H2c/hubdev/*.hubdev.test.ts` · P `apps/agent-runtime/tests/acceptance/{test_files_rules.py,_hub_files.py,attachments_int_test.py,outputs_int_test.py}` · SM `tests/smoke/h2c-live.test.ts` (I2) |
| Dữ liệu | Fixture H1/H2a/H2b + `_h2c.ts` mới (§2.1). File mẫu sinh trong test (byte cố định: `%PDF-1.4…`, PNG 8 byte chữ ký, `PK\x03\x04`, UTF-8 có/không BOM) — không commit file nhị phân |
| Id (TC-3 H2b) | Mọi id do test chèn SQL: `crypto.randomUUID()`/`uuid4()`; id cố định bắt buộc → `DEL run:<id> sse:<id>` trước khi dùng. Run/attachment do Hub tạo: id ngẫu nhiên sẵn |
| Ca tự dọn (TC-3/TC-6) | Ca đổi cấu hình (entitlement, grant, command, `tenantMaxBytes`) khôi phục ở `finally` **và** chờ cache Hub nạp lại (≤ 5 s, poll 100 ms, điều kiện phản ánh **thay đổi cuối**) trước khi ca kế dùng. Ca đếm hàng/job: chờ run của chính ca kết thúc (`settleRuns`) trước `counts()` (TC-7) |
| Đĩa | Kiểm "0 file" = liệt kê đệ quy `HUB_ATTACH_DIR` (không `.part`, không file lạ); tên trên đĩa chỉ `<uuid>/<uuid>` (AC-04). Quyền 0700/0600/0400: chỉ assert khi `process.platform !== "win32"` (P23) bằng nhánh `if` trong ca, không `skip` |
| Log | `setSink` bắt theo tên `plan-errors` §5; assert **vắng** tên file/nội dung/token trong mọi dòng log của ca |
| Đếm MK (TC-2) | Đếm lời gọi `/v1/files/upload` và `/v1/workflows/run` theo `user`/tên file của ca, không đếm tổng sau `reset()` |

## 2. Hạ tầng và giả lập
| Mục | Đề xuất | Ai |
|---|---|---|
| DB TS (I1 H2a) | `TEST_DATABASE_URL`/`TEST_ADMIN_API_DATABASE_URL` = `ai_system_h2c_<nhóm>_test`; DB Hub/Runtime **riêng** `ai_system_h2c_<nhóm>_hub_test` (`HUB_TEST_DATABASE_URL`, `AGENT_RT_TEST_DATABASE_URL`) — chung DB TS → `DuplicateTableError` ở `ensure_schema` | qc |
| Env | `.env.test-h2c_<nhóm>.local`; chỉ **export 4 biến DB** (không `source` cả file: PEM nhiều dòng hỏng). `apps/agent-runtime/scripts/run.ts` (Windows → container) **truyền env DB ngay trong chuỗi lệnh**: `bun apps/agent-runtime/scripts/run.ts "AGENT_RT_TEST_DATABASE_URL=… HUB_TEST_DATABASE_URL=… uv run pytest -m int tests/acceptance/attachments_int_test.py"` | qc |
| Lọc test | `bun --env-file=… --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H2c/upload.int.test.ts` (đường dẫn `./`); **không** `bun run test:int <path>` (script có sẵn bộ lọc `.int.test` ⇒ chạy cả repo). Stack/hubdev: `--config=bunfig.stack.toml` |
| Redis | `redis://localhost:6379/15` dùng chung → id ngẫu nhiên / xoá key (TC-3) | qc |
| Storage (A) | `mkdtemp` mỗi file test → `AppDeps.attachments = {storage: await createLocalStorage({dir}), tenantMaxBytes, sweepS}` (Lệch L1, L8); `afterAll` xoá thư mục | qc |
| Runtime kịch bản (A) | `ScriptRuntime3` (H2b) + claim có `token_hash` (`_h2a2.ts` `claimWithToken`) → gọi `GET /internal/jobs/:id/attachments/:att`, `POST …/outputs` bằng token như Runtime | qc |
| MK TS — **sửa mock khoá** | `tools/hub-dev/src/dify-mock.ts` + `/v1/files/upload` (task **MK-U**, qc, trong QW-A2; spec §7, plan-runtime F14): xử lý **trước** `record()` (hàm này `req.text()` + `JSON.parse` ⇒ multipart mất) bằng `req.formData()`; ghi `MockCall{path, auth, body:{user, file:{name, type, size, sha256}}}`; trả **201** `{id:"upl-<seq>", name, size, extension, mime_type, created_by:"mock", created_at}`; chỉ thị theo **tên file** (Hub gửi `safe_name` ⇒ test chọn qua `X-Filename`): `upload-413*` → 413 `file_too_large`, `upload-415*` → 415 `unsupported_file_type`, `upload-400-too-large*` → 400 `{code:"file_too_large"}`, `upload-500*` → 500, `upload-noid*` → 201 thân không `id`, `upload-slow-<ms>*` → chờ; theo **key**: `mk-401/404/400` → status như workflow (`NOT_CONFIGURED` cho 401/404); thiếu phần `file` → 400 `no_file_uploaded`. Mọi kịch bản cũ giữ byte-for-byte (JSON vẫn qua `record`). Test mock `tools/hub-dev/src/dify-mock.test.ts` thêm ca upload (không khoá). **Khoá lại**: ở Q2 `test:lock:verify` phải ra đúng **1 `CHANGED tools/hub-dev/src/dify-mock.ts`** + các `UNLOCKED` H2c; trước khi ghi chạy `bun test tools/hub-dev` + `tests/acceptance/H2a/{command-run,async,mcp,dify-errors}.int.test.ts` + `bun run test:h2a:stack` xanh nguyên văn ⇒ `test:lock:write` | qc |
| Mock Python Dify | `apps/agent-runtime/tests/support/dify_mock.py` (khoá) — **không sửa**: `_record` ghi **mọi** path trước khi định tuyến, path lạ → 404 ⇒ đủ để assert Runtime 0 lời gọi `/v1/files/upload` (AC-10, P38). Readiness muốn route tường minh → sửa + khoá như MK-U ở Q3 (`CHANGED` đúng 1 dòng, `test_dify_mock.py` xanh) | — |
| Mock Hub file (P) | `apps/agent-runtime/tests/acceptance/_hub_files.py` (qc, QW-P; Lệch L6): server asyncio như `dify_mock.py` — `GET /internal/jobs/:job/attachments/:id` (nội dung đăng ký theo id; chỉ thị theo id: `sha-wrong`, `short`, `long`, `5xx-once`, `5xx-always`, `401`, `404`, `slow=<ms>`), `POST /internal/jobs/:job/outputs` (đọc thân stream, ghi `X-Filename`/`Authorization`/`Content-Length`/sha256; trả 201 `{id: uuid4}`; chỉ thị theo tên giải mã: `*.exe` → 415, `quota-*` → 409, `deny-*` → 401, `flaky-*` → 503 một lần, `hold-<ms>-*` → giữ trước khi trả) ; `calls(prefix)` | qc |
| `fake-cli` | `plan-runtime` §6: `#fake:files`, `#fake:out`, `#fake:out-size`, `#fake:out-link`; có sẵn `#fake:read`, `delegate`, `sleep`, `tool`, `args`, `partial`, `need_input` | backend-lead PY-04 |
| Stack (S) | Mẫu `H2b/stack/_stack.ts`: hub-api **trên host** (env `HUB_ATTACH_DRIVER=local`, `HUB_ATTACH_DIR=<mkdtemp tuyệt đối>`, `HUB_MAX_CONCURRENT_RUNS=2` tường minh), catalog `base_url` = `http://localhost:<MK>/v1`; chỉ container Runtime dùng `host.docker.internal` (`--add-host …:host-gateway`), `AGENT_RT_HUB_URL=http://host.docker.internal:<hub>` (TC-4). Nếu đặt `AGENT_RT_ORPHAN_S=5` thì **`AGENT_RT_HEARTBEAT_S=1`** (heartbeat < orphan — TC-5/7) | qc / MK |
| Lock | `tests/acceptance/H2c/**`, `apps/agent-runtime/tests/acceptance/*` mới, `dify-mock.ts` (CHANGED). `tests/smoke/**` không khoá | qc |

### 2.1 Fixture `_h2c.ts` (SQL owner, sau `setupH2b({catalogBaseUrl})`)
| Mục | Giá trị |
|---|---|
| Workflow `hoadon-file` | input `file` (type `file`, bắt buộc, mô tả "Hoá đơn PDF") + `note` (text, tuỳ chọn); key `mk-ok` |
| Workflow `anh-tuy-chon` | input `img` (type `file`, **tuỳ chọn**) + `q` (text bắt buộc) — K10 `mcpToolsFor` |
| Command | `/hoadon` (sync: `file ← attachment`, `note ← arg rest`) · `/hoadon-async` (async, như trên) · `/sai-map` (`q` text ← `attachment` ⇒ `invalid`) · `/file-arg` (`file ← arg` ⇒ `invalid`) · `/hoadon-tuy` (`file` tuỳ chọn ← `attachment`) |
| Agent | `hoadon` + entitlement acme (AC-H03; chỉ DB của file dùng) ↔ `hoadon-file`, `create-trello-card`; `trello` (H2a) |
| Helper | `startHubH2c(k, {tenantMaxBytes?, extra})` (bọc `startHubH2b`) · `upload(hub, who, bytes, name, o?: {contentLength?: number \| null, chunked?: boolean})` · `rawUpload(port, headers, body)` (socket thô, L3) · `send(hub, who, conv, content, ids)` · `diskFiles(dir)` · `sample.{pdf,png,jpg,docx,csv,txt,md}(n)` · `insertAttachmentRow(sql, o)` (hàng giả cỡ lớn cho R14, không file) · `claimWithToken(sql, runId)` · `internalGet(hub, job, token, att)` · `postOutput(hub, job, token, name, bytes)` · `sweepOnce(deps, now)` (L1) |

## 3. Ma trận mã → test
| Mã | Test | Loại |
|---|---|---|
| **HUB-FR-44** · AC-01, 02, 03, 04, 06, 13, 14, 15 | R01–R30, R42–R47, A01–A29, A40–A62, A120–A129, A140–A142, H01, PF1–PF3 | R, A, H |
| **HUB-FR-75** · AC-05, AC-07 (vế 401) | R28, R29, A30–A37, A42, A53, A80–A89, A131 | R, A |
| **HUB-FR-12** · **ADM-FR-21** · AC-09, AC-10 | R31–R34, R39–R41, A100–A109, P38, S05 | R, A, P, S |
| **HUB-FR-50** · AC-11 | R35–R38, A110–A116 | R, A |
| **WRK-FR-11** · AC-07 · AC-08 | R17–R24, A70–A79, P01–P04, P20–P32, S01, S02, S07 | R, A, P, S |
| **WRK-BR-06** (phần file) | A80–A89, P20–P29, S02 | A, P, S |
| **WRK-BR-07** (tên/đường dẫn) | R02, R07, R08, R47, P01, P24, P25, P28, P29, S02 | R, P, S |
| **WRK-FR-18** · AC-12 | R23, A90–A99, P05–P08, P40–P50, S03, S04 | R, A, P, S |
| **AC-H03** (vế đính kèm) | A79, S06 | A, S |
| HUB-H2c-AC-16 · R30 | A140–A142, K01–K12 | A, K |
| HUB-H2c-AC-17 | SM1, SM2, M01 | SM, M |
| Contract chat/hub/hub-internal (spec §3) | R44–R49 | R |
| DB `0007` (spec §4) | A130–A134 (+ D1 `packages/db/src/hub-h2c.int.test.ts`, K10) | A |
| K10 (đổi hành vi H2a) | R33, R35, A106, A114 | R, A |

**Luật → ca** (mỗi luật ≥ 1 ca):

| Luật | Ca | Luật | Ca | Luật | Ca |
|---|---|---|---|---|---|
| R01 | R01, A01–A08 | R11 | A44–A46, A53–A55 | R21 | A100, A104, A105, A108, P38, S05 |
| R02 | R02–R08, A09, A10 | R12 | R42, A47–A49 | R22 | R10, R39–R41, A101–A103 |
| R03 | R11–R16, A11–A14 | R13 | R09, A30–A37 | R23 | R35–R38, A110–A116 |
| R04 | R26–R29, A25–A29 | R14 | R17, R18, A56–A62 | R24 | R23, A74, P47 |
| R05 | A15–A17 | R15 | R19–R22, R24, A70–A78 | R25 | P05–P08, A90–A95, P40–P50, S03 |
| R06 | R25, A20–A24 | R16 | P01–P04, P20–P32 | R26 | A96–A99, S03, S04 |
| R07 | A18, A19 | R17 | A80–A89 | R27 | R30, A120, A121 |
| R08 | A40, A41 | R18 | P29, S02, S07 | R28 | A122–A124 |
| R09 | A42, A43 | R19 | P20, S01, S03 | R29 | R30, A125–A129, PF3 |
| R10 | A50–A52 | R20 | R31–R34, A100, A106–A109 | R30 | A140–A142, K01–K12 |

**Không phủ ở H2c:**

| Mã / vế | Lý do · mốc |
|---|---|
| Chip tải lên, lỗi `ATTACHMENT_*`, file `out/` trên Chat | combine (CR-impact I3), e2e Chat |
| Quét virus, S3/MinIO, hạn mức theo tenant, `routing_tests.has_attachment` | spec §1 "Không làm" (H3/H4/ops) |
| File cho `dify-workflow`/`dify-agent` trong Hub, runtime `llm`/`python` | T11, H2d |
| `claude-sub` đọc PDF/ảnh thật | SM1/SM2 (I2, không chặn) |
| Dọn `work/<job_id>/` sau job | TD #59 (K7) |

## 4. R · Hàm thuần TS (chữ ký `plan-rules.md`) — bảng ca: cases §1
| ID | File (`H2c/rules/`) | Hàm | Số ca |
|---|---|---|---|
| R01–R10 | `attachment-name.test.ts` | `parseFilenameHeader`, `displayName`, `splitExt`, `extOf`, `mimeOf`, `safeName` (bảng AC-04), `contentDisposition`, `difyFileType` | 10 (~55 dòng bảng) |
| R11–R16 | `sniff.test.ts` | `isExecutableHead`, `headOk`, `FileInspector` (bảng AC-03) | 6 (~35) |
| R17–R24 | `run-files.test.ts` | `pickRunFiles`, `jobFileNames`, `jobAttachments`, `fileSizeKb`, khối file, `withOutHint`, `orchestratorPrompt`, `buildJobPayload` | 8 (~30) |
| R25–R30 | `attach-limits.test.ts` | `overQuota`, `parseAttachEnv`, `storageKey`/`isStorageKey`/`keyUnder`, `orphanCandidate`, hằng | 6 (~35) |
| R31–R34 | `command-input-h2c.test.ts` | `buildInputs` + `attachment` | 4 |
| R35–R38 | `mcp-h2c.test.ts` | `mcpToolsFor` + `hasFiles`, `toolInputSchema`, `fileArg`, `TOOL_FILE_TEXT` | 4 |
| R39–R41 | `dify-upload.test.ts` · `run-errors-h2c.test.ts` | `mapDifyUploadError`, `difyUploadId`, `runErrorTextFor` `file_rejected` | 3 |
| R42–R43 | `messages-h2c.test.ts` | `toMessage` + `refs`, `toAttachmentRef` | 2 |
| R44–R49 | `contracts-h2c.test.ts` | chat chỉ thêm; hub `JobAttachment`, `DifyFileInput`, `outputs`, reason; hub-internal; fixture | 6 |

## 5. A · hub-api int — bảng ca: [`test-plan-int.md`](test-plan-int.md)
| File (`H2c/`) | ID | Mã đầu tên |
|---|---|---|
| `upload.int.test.ts` | A01–A19 | HUB-FR-44 |
| `quota.int.test.ts` | A20–A24 | HUB-FR-44 |
| `storage.int.test.ts` | A25–A29 | HUB-FR-44 |
| `content.int.test.ts` | A30–A37 | HUB-FR-75 / HUB-FR-44 |
| `send.int.test.ts` | A40–A52 | HUB-FR-44 / HUB-FR-75 (A42) |
| `bind-race.int.test.ts` | A53–A55 | HUB-FR-44 |
| `run-files.int.test.ts` | A56–A62 | HUB-FR-44 |
| `agent-job.int.test.ts` | A70–A79 | WRK-FR-11 / AC-H03 (A79) |
| `internal-download.int.test.ts` | A80–A89 | HUB-FR-75 / WRK-BR-06 |
| `outputs.int.test.ts` | A90–A99 | WRK-FR-18 |
| `command-file.int.test.ts` | A100–A109 | HUB-FR-12 / ADM-FR-21 |
| `mcp-file.int.test.ts` | A110–A116 | HUB-FR-50 |
| `sweeper.int.test.ts` | A120–A129 | HUB-FR-44 |
| `db.int.test.ts` | A130–A134 | HUB-FR-44 / HUB-FR-75 |
| `compat.int.test.ts` | A140–A142 | HUB-FR-44 |
| `perf.perf.int.test.ts` | PF1–PF3 | HUB-FR-44 (không chặn) |

## 6. P · S · H · SM · K · M
P01–P08 (unit `test_files_rules.py`), P20–P32 (`attachments_int_test.py`), P38 (async Dify), P40–P50 (`outputs_int_test.py`), S01–S07, SM1–SM2: [`test-plan-py.md`](test-plan-py.md). H01, K01–K12, M01–M03: cases §3–§4.

## 7. Lệnh
### 7.1 `bun run done:h2c` (`tools/scripts/src/done-h2c.ts`, mẫu `done-h2b.ts`: `h2cSteps()` dựng từ `h2bSteps()` bằng `byTitle`/`extend`; tuần tự) — **mọi bước `done:h2b`** + phần H2c (**in đậm**)
| # | Bước | Chặn |
|---|---|---|
| 1 | `bunx turbo run typecheck --filter=@ai/hub-api --filter=@ai/contracts --filter=@ai/db --filter=@ai/scripts --filter=@ai/chat-web --filter=@ai/mocks` | ✓ |
| 2 | `bun test packages/contracts packages/db tools/hub-dev apps/admin-api/src/modules/access tests/acceptance/C1 tests/acceptance/H1/rules tests/acceptance/H2a/rules tests/acceptance/H2b/rules` **`tests/acceptance/H2c/rules`** (gồm `dify-mock.test.ts` ca upload) | ✓ |
| 3 | `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/H1/ tests/acceptance/H2a/ tests/acceptance/H2b/` **`tests/acceptance/H2c/`** `tests/acceptance/M tests/acceptance/ADM-NFR-06` (`bunfig.int.toml` + **`H2c/stack/**`, `H2c/hubdev/**`**) | ✓ |
| 4 | `bun run contracts:check` | ✓ |
| 5 | Python như `done:h2b` (ruff, format, pyright, lint-imports, `pytest`, `pytest -m int`) — gồm **`test_files_rules.py`, `attachments_int_test.py`, `outputs_int_test.py`** | ✓ |
| 6–9 | `bun run test:h1:stack` · `test:h2a:stack` · `test:h2b:stack` · **`bun run test:h2c:stack`** (S01–S07; `HUB_ATTACH_*` + `HUB_MAX_CONCURRENT_RUNS=2` trong script) | ✓ |
| 10 | `HUB_URL=… AUTH_URL=… CHAT_CONTRACT_USERS='<json>' bun run test:contract:chat` (hub-dev có `HUB_ATTACH_*` thư mục tạm — MK; **41 pass**, AC-16) | ✓ |
| 11 | `bun … --config=bunfig.stack.toml test tests/acceptance/H2b/hubdev` (H2b H01) | ✓ |
| 12 | **`bun … --config=bunfig.stack.toml test tests/acceptance/H2c/hubdev`** (H01, `needsDev`) | ✓ |
| 13–16 | `test:lock:verify` · `trace --check` · `check:size --all` · `bunx depcruise apps/hub-api packages/contracts/src/hub packages/contracts/src/hub-internal packages/db tools/hub-dev` | ✓ |
| 17 | `tsc -p tsconfig.tests.json` | báo cáo |
| 18 | `bun run test:perf tests/acceptance/H2a tests/acceptance/H2b` **`tests/acceptance/H2c`** | báo cáo |

Không thuộc `done:h2c`: `HUB_LIVE=1 bun run test:smoke:live` (I2, AC-17). `done-h2c.test.ts` (MK): đủ 18 bước, thứ tự, mọi tiêu đề `done:h2b` có mặt.

### 7.2 Thủ công: smoke AC-17 (M01), `docs/guides/hub-dev.md` `UPLOAD_FILE_SIZE_LIMIT` (M02), PRODUCTION-NOTES (M03) — cases §4.

## 8. Nhóm WRITE · đợt khoá (sau Gate)
| Nhóm | Khi | File | Ca (≈) | Phải đỏ đúng lý do vì |
|---|---|---|---|---|
| QW-R | sau B0 (stub), C1, C2 | 10 file `rules/` | 49 ID / ~200 dòng bảng | stub `throw not implemented`. **Xanh trước code chấp nhận**: R44–R49 (C1/C2 có), R24/R21 vế "vắng ⇒ y hệt", R35 vế `hasFiles` vắng, R31 vế không `attachment`, R41 vế cũ, R42 vế không `refs` (hồi quy) |
| QW-A1 | sau QW-R, D1 | `upload`, `quota`, `storage`, `content`, `send`, `bind-race`, `run-files`, `sweeper`, `db`, `compat`, perf | ~75 | `/attachments` 404 (chưa mount), `attachment_ids` bị `strictObject` từ chối 400 / bỏ qua, `createLocalStorage`/`sweepOnce` chưa có (import trong thân `beforeAll` ⇒ lỗi `expect` có thông điệp, **không** `TypeError` dựng dữ liệu — dùng `expect(typeof fn).toBe("function")` ca đầu file). Xanh trước code: A130–A134 (D1), A140–A142 (H2b), A05 vế 401 |
| QW-A2 | sau QW-A1, C2 + **MK-U** | `agent-job`, `internal-download`, `outputs`, `command-file`, `mcp-file` + `dify-mock.ts`/`.test.ts` | ~45 | payload không `attachments`, prompt không khối file, `/internal/jobs/:id/attachments` 404 thay 200/401, `/outputs` 404, MK 0 `/files/upload`, `tools/list` như H2a. Xanh trước code: vế 401 không token (route 404 ⇒ **đỏ**, chấp nhận), ca "vắng file ⇒ như H2b" |
| **Q2** | sau QW-A2 | khoá `tests/acceptance/H2c/**` (trừ `stack/`, `hubdev/`) + `dify-mock.ts` | — | verify trước ghi: chỉ `UNLOCKED` H2c + đúng 1 `CHANGED dify-mock.ts`; hồi quy MK-U xanh (§2) |
| QW-PU | sau Q2, PY-00, **trước PY-01** | `test_files_rules.py` | P01–P08 (~60 dòng) | `NotImplementedError` của stub PY-00 (import đầu file được vì stub có — khác H2b) |
| **Q-PU** | sau QW-PU | `test:lock:verify` đúng **1** `UNLOCKED` → `test:lock:write` | — | — |
| QW-P | sau PY-02 | `_hub_files.py`, `attachments_int_test.py`, `outputs_int_test.py`; `stack/*` (S01–S07), `hubdev/` (H01) | P ~40 · S 7 · H 1 | P tải: xanh phần lớn (PY-02 xong) — đỏ: `#fake:files` (PY-04); P out: `outputs` vắng (PY-03); S: chờ B5/B6/B9 + PY-03/04. Fixture/DB/mock/Runtime boot phải xanh |
| **Q3** | sau QW-P, **trước PY-03** | khoá P int + `stack/` + `hubdev/` | — | verify: chỉ `UNLOCKED` file QW-P |
| SM | I2 (backend-lead viết, qc duyệt) | `tests/smoke/h2c-live.test.ts` | 2 | không khoá; vắng `HUB_LIVE` → skip |

Tổng mới ≈ **270** ca (R ~200 dòng bảng / 49 ID, A ~120, P ~48, S 7, H 1, PF 3) + K 12 + M 3 + SM 2. Model: QW-R/A1/A2/PU/P = Opus (`cao` — quyền/tenant/đường dẫn), Q2/Q-PU/Q3/I1 = Sonnet.

## 9. Rủi ro test · câu hỏi (mặc định dùng nếu không trả lời — **không có câu hỏi bắt buộc cho người dùng**)
| # | Rủi ro / câu hỏi | Mặc định |
|---|---|---|
| Q-T1 | Ổ đĩa test: 20 MiB × nhiều ca + perf | Thư mục tạm mỗi file, xoá `afterAll`; R14 cỡ lớn dùng hàng SQL giả (`insertAttachmentRow`, không file) |
| Q-T2 | Song song không tất định (AC-06, AC-14) | 5 vòng, uuid mới mỗi vòng; mỗi vòng đúng 1/2 (AC-06), đúng 2/3 (AC-14); `pgDeadlocks` không tăng |
| Q-T3 | Ngưỡng thời gian Windows (perf, sweeper ≤ 2 s, tải 10 × 2 MiB ≤ 2 s) | PF/P32 không chặn (báo cáo); ca chặn chỉ assert kết quả |
| Q-T4 | Đồng hồ sweeper | Chỉ qua `now` tiêm (L1); 24 h + 1 s / 24 h − 1 s; mtime file bằng `utimes` |
| Q-T5 | `realpath` ngoài gốc khó dựng | Symlink thư mục tenant → ngoài gốc (Linux/WSL); Windows: junction nếu tạo được, không thì ca chỉ kiểm `keyUnder` (R29) + `StorageKeyError` key sai |
| Q-T6 | Bun và `Content-Length` sai/chunked (K8) | L3 |
| R-WIN | P/S không chạy trên Windows | P qua `scripts/run.ts` (container), S ở WSL2/Docker như H2b |

### Lệch plan (readiness xử)
| # | Lệch | Đề xuất |
|---|---|---|
| L1 | Plan §5.8 "`now` tiêm được" nhưng không chốt seam để int chạy **một lượt** sweeper với đồng hồ giả; vòng lặp nền 600 s có thể chen vào ca | `attachments/sweeper.ts` export `sweepOnce(d: {sql, storage, now: Date}) → {expired, purged, orphans}` (dùng cho cả loop); `AppDeps.attachments.sweep?: false` tắt vòng nền trong test |
| L2 | AC-14 "env 1 MiB" mâu thuẫn `parseAttachEnv` (< `ATTACH_MAX_BYTES` ⇒ ném) | A20–A22 truyền `tenantMaxBytes = 1 MiB` qua `AppDeps` (seam); vế env chỉ ở R26 |
| L3 | AC-02 "`Content-Length` giả nhỏ hơn thân → 413": HTTP/1.1 server đọc đúng `Content-Length` byte, phần dư là rác của request sau ⇒ không thể có 413 theo chốt đếm | Chia: (a) **chunked** không `Content-Length`, 20 MiB + 1 → 413, 0 hàng/`.part` (A04); (b) socket thô `Content-Length: 1024` + thân 20 MiB + 1 → không lưu file > 1 024 B, không `.part`, Hub phục vụ request kế (A05) — không ép 413 |
| L4 | AC-08 "đích là symlink sẵn" không dựng được qua int: `prepare_job_dirs` xoá/làm mới `attachments/` trước khi tải (plan-runtime §3.1) | Như F15: vế `O_EXCL\|O_NOFOLLOW` ⇒ gọi thẳng `fetch_attachments` với `dest` có symlink (P25, trong `attachments_int_test.py`, `FetchFailed(exists)`, đích ngoài không đổi); int: symlink `attachments`/`out` đặt sẵn bị thay, đích ngoài nguyên vẹn, job chạy đúng (P28) |
| L5 | AC-H03 chuỗi `hoadon → trello → answer`: `fake-cli` Orchestrator chỉ đọc chỉ thị tin hiện tại ⇒ không có kịch bản nhiều bước | Chuỗi đủ ở **A79** (`ScriptRuntime` quyết định từng bước); stack S06 một delegate `hoadon` + `#fake:files` (đọc file thật). Không thêm chỉ thị fake |
| L6 | plan-runtime §8 đặt mock Hub file ở `tests/support/hub_files_mock.py` — ngoài `LOCKED_DIRS` | Đặt `tests/acceptance/_hub_files.py` (tự khoá như `_dify.py`, `_stream.py`); không sửa `test-lock.ts` |
| L7 | AC-12 "`.exe` trong `out/`": `#fake:out=x.exe` ghi chữ ⇒ Hub 415 do **đuôi** (đúng luật), không do chữ ký | Thêm vế chữ ký: S03 `#fake:out=bad.pdf` (nội dung chữ, đuôi `.pdf`) → 415 → bỏ |
| L8 | Plan §4 `createLocalStorage(env)` chưa chốt chữ ký; int cần dựng driver với thư mục tạm | `createLocalStorage(o: {dir: string; platform?: NodeJS.Platform}): Promise<AttachmentStorage>` (ném khi tạo/ghi thử lỗi) export từ `storage.local.ts` |
| L9 | R13 `available=false` của file trong hội thoại **đã xoá** không quan sát được qua API (P22 ⇒ 404) | A123 kiểm `purged_at` (SQL owner) + `/content` 404; `available=false` quan sát ở hội thoại **còn** bằng hàng gắn có `purged_at` đặt qua SQL owner (A124: E10 `available:false`, `GET` `available:false`, `/content` 404, không vào `A` của run sau) và R43 |
| L10 | Perf Python 10 × 2 MiB ≤ 2 s (spec §6) trong container Windows dao động | P32 ghi số đo, không chặn (như PF) |

## 10. Đỏ đúng lý do · nhật ký
Tách sang [`test-plan-log.md`](test-plan-log.md) ngay từ đầu (trần 25 600 B mỗi file).
