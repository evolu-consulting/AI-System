# Test plan · H2c-attachments · phụ lục Python, stack, smoke (qc)

Phụ lục của [`test-plan.md`](test-plan.md). Chữ ký: `plan-runtime.md` §3.2 (`fetch_attachments`, `FetchResult`), §4 (luật thuần), §5 (`send_outputs`), chỉ thị `fake-cli` §6, đối chiếu §9 (F1–F15). Chạy: `bun apps/agent-runtime/scripts/run.ts "AGENT_RT_TEST_DATABASE_URL=… HUB_TEST_DATABASE_URL=… uv run pytest -m int tests/acceptance/<file>"` (env DB **trong chuỗi lệnh**; DB Hub/Runtime riêng — test-plan §2).

## 1. P · unit thuần `tests/acceptance/test_files_rules.py` (QW-PU → Q-PU, trước PY-01)
Import `agent_runtime.runtimes.cli.files.rules` (stub PY-00 có sẵn ⇒ đỏ `NotImplementedError`, không `ModuleNotFoundError`). Mã: WRK-FR-11 (P01–P04), WRK-BR-07 (P01), WRK-FR-18 (P05–P08).

| ID | Hàm | Ca → kỳ vọng |
|---|---|---|
| P01 | `valid_job_file_name` | True: `"a.pdf"`, `"Hoá đơn tháng 9.pdf"` (NFC), `"CON_.txt"`, `"_-x.md"`, `"a-2.pdf"`, 120 byte UTF-8; False: `""`, `"."`, `".."`, `".env"`, `"-x"`, `"../x"`, `"a/b"`, `"a\\b"`, `"a\x00b"`, `"a\nb"`, NFD `"á.txt"`, 121 byte (`"ạ"` × 41 = 123 byte), `"a<b>.md"`, `"a\udcff"` (surrogate — mã hoá lỗi); mọi tên đầu ra bảng R07 Hub (`safeName`) → True |
| P02 | `classify_fetch` | `None` → `retry`; 200 → `ok`; 401 → `unauthorized`; 404 → `not_found`; 500, 502, 503 → `retry`; 400, 403, 409, 302 → `http` |
| P03 | `backoff` | 0 → 1.0; 1 → 3.0; 2, 3 → None; hằng `FETCH_BACKOFF_S == (1.0, 3.0)`, `FETCH_TIMEOUT_S == 60.0` |
| P04 | hằng | `JOB_FILE_NAME_MAX_BYTES == 120`, `ATTACH_MAX_BYTES == 20_971_520`, `OUT_MAX_FILES == 5` (khớp contract `JOB_FILE_NAME_MAX`, `ATTACH_MAX_BYTES`, `JOB_OUTPUTS_MAX` trong `contracts/hub.py` nếu có hằng) |
| P05 | `pick_outputs` | loại theo thứ tự: symlink → `symlink`, dir → `dir`, other → `other`, size 0 → `empty`, 20 971 521 → `too_large`, tên có `/`/`\\`/NUL/surrogate → `bad_name`; 7 file hợp lệ `g,f,e,d,c,b,a` → chọn `a…e` (sắp code point: `"B" < "a"`), 2 × `over_limit`; đúng `ATTACH_MAX_BYTES` → chọn; kết quả `OutEntry` giữ nguyên `size` |
| P06 | `filename_header` | `"report.md"` → `"report.md"`; `"Báo cáo.md"` → `"B%C3%A1o%20c%C3%A1o.md"`; `"a/b"` → `"a%2Fb"`; `"%"` → `"%25"`; kết quả chỉ ASCII `0x20–0x7E` (khớp `parseFilenameHeader` Hub — R01) |
| P07 | `classify_output` | 201 → `ok`; 400, 409, 413, 415 → `skip`; 401 → `stop`; `None`, 500, 503 → `retry`; 200, 404, 422 → `skip` |
| P08 | `wants_outputs` | `("agent", {"kind":"agent_result","result":{"status":"done"}})` → True; `partial` → True; `need_input` → False; `("orchestrator", …done)` → False; `None` → False; `kind` khác → False |

## 2. P · int Runtime thật (`fake-cli`) — QW-P, khoá Q3
Hub giả: `_hub_files.py` (test-plan §2, L6) trên `127.0.0.1:<port>` = `AGENT_RT_HUB_URL`; job `agent.cli` chèn bằng `_rt.py` (khoá) + vá `payload.attachments` như `_stream.py` (NOTIFY sau). Hộp đen: `hub.jobs` (`status`, `error_code`, `error_reason`), Redis `run:<id>`, cây `work/<job_id>/`, log JSON, `calls()` của mock.

### 2.1 `attachments_int_test.py` (P20–P32) · WRK-FR-11 · WRK-BR-06 · HUB-H2c-AC-08
| ID | Given/When → Then |
|---|---|
| P20 | R16/R19: 2 file (`a.pdf` 3 KB, `Hoá đơn.pdf`), task `#fake:files` → `job.result` `done`, text = `"Hoá đơn.pdf:<sha>\na.pdf:<sha>"` (sắp tên); mock nhận 2 `GET /internal/jobs/<id>/attachments/<att>` tuần tự theo payload, `Authorization: Bearer <t>` với `sha256(t) = jobs.token_hash`; trên đĩa: thư mục `attachments/` 0700, file 0400 |
| P21 | AC-08 sha sai (`sha-wrong`) → `job.failed{INTERNAL_ERROR, reason:"attachment"}` (`jobs.error_reason='attachment'`), `attachments/` rỗng (kể cả file khác đã tải), provider **không** chạy (không `job.progress`/usage), log `job.attachment_failed{attachment_id, why:"sha_mismatch"}` không tên file/token/URL đầy đủ |
| P22 | Thiếu byte (`short`) → `size_mismatch`, như P21 |
| P23 | Thừa byte (`long`) → huỷ đọc khi vượt `size`, `size_mismatch`, file dở xoá |
| P24 | AC-08 `name` có `..` (F15): payload `attachments[0].name = "../x"` → `job.failed invalid_payload` (H1), **0** GET tới mock, không file nào ngoài `work/<job_id>/` |
| P25 | F15/L4 — gọi thẳng `fetch_attachments(client, hub_url, job, items, dest, …)`: mục `name="../x"` → `FetchFailed(why="bad_name")`, 0 GET; `dest` có sẵn symlink `a.pdf → <tmp>/victim` → `FetchFailed(why="exists")`, `victim` không đổi; `dest/sub` là symlink ra ngoài (`realpath` lệch) → `path`; sau mọi `FetchFailed` `dest` rỗng |
| P26 | AC-08 5xx một lần (`5xx-once`) → thử lại sau ≈ 1 s, `done`, sha đúng, mock 2 GET cho id đó; `5xx-always` → 3 GET (1 + 2 thử lại, cách ≈ 1 s, 3 s) rồi `failed attachment` (`why` `http`/`network`) |
| P27 | 401 → `failed attachment` (`unauthorized`), 1 GET (không thử lại); 404 → `not_found`, 1 GET |
| P28 | L4: `work/<job_id>/attachments` và `out` đặt sẵn là symlink → `<tmp>/outside` (có file `keep`) → job chạy đúng (`#fake:files` ra file mới), `outside/keep` nguyên vẹn, `attachments` là thư mục thật |
| P29 | R18 · requeue cùng `job_id` (F11): `work/<job_id>/attachments/old.txt`, `out/old.md` từ lần claim trước → sau chạy lại `attachments` chỉ file payload, `out` không còn `old.md`; `#fake:read=../<job khác>/attachments/a.pdf` → `denied` (hook `other_job`) |
| P30 | Thiếu `AGENT_RT_HUB_URL` (Runtime khởi động không `dify`) + job có file → `failed attachment` (`no_hub_url`); job **không** file → chạy bình thường |
| P31 | Hạn/huỷ: `slow=5000` + `timeout_s=10` 3 file → `timed_out`, file đã ghi bị xoá; huỷ run khi đang tải → `cancelled` ≤ 5 s, `attachments/` rỗng; shutdown khi đang tải → `stopped_no_write` (không ghi kết cục) |
| P32 | Không `attachments` / `[]` → 0 GET, kết quả **như H2b** (cùng sự kiện, không thư mục `attachments`); perf 10 × 2 MiB: ghi `ms` (L10, báo cáo — ngưỡng 2 s không chặn) |

### 2.2 `outputs_int_test.py` (P38, P40–P50) · WRK-FR-18 · HUB-H2c-AC-10 (Runtime) · AC-12
| ID | Given/When → Then |
|---|---|
| P38 | AC-10 (Runtime): job `workflow.async` `inputs.file = {type:"document", transfer_method:"local_file", upload_file_id:"u1"}` (dify_mock.py) → `/v1/workflows/run` nhận `inputs` **nguyên** (so dict); `calls("/v1/files/upload") == []` |
| P40 | R25: `#fake:out=report.md` → mock 1 `POST /internal/jobs/<id>/outputs`: `X-Filename: report.md`, `Content-Type: application/octet-stream`, `Content-Length` = độ dài thân (22), thân `"fake output report.md\n"`, Bearer token job; `job.result.outputs == [<id mock>]` |
| P41 | F9: tên `hold-800-r.md` (mock giữ 800 ms) → trong lúc giữ `hub.jobs.status='running'` và `run:<id>` chưa có `job.result`; sau đó `job.result` có `outputs` |
| P42 | `Báo cáo.md` → `X-Filename` = `filename_header` (pct UTF-8) |
| P43 | AC-12: 6 tên `a.md…f.md` → 5 POST (`a…e`), `outputs` 5 id, log `job.output_skipped{why:"over_limit"}` × 1 |
| P44 | AC-12: `#fake:out-link=x.md` (+ `#fake:out=y.md`) → chỉ `y.md` gửi |
| P45 | AC-12: mock 415 (`x.exe`), 409 (`quota-1.md`) → bỏ, job `succeeded`, `outputs` chỉ file 201; `deny-1.md` (401) → ngừng gửi phần còn lại (`stop`); `flaky-1.md` (503 một lần) → gửi lại, có trong `outputs` |
| P46 | `#fake:out=e.md #fake:out-size=0` → `empty`, không POST, **không** khoá `outputs`; `out-size=20971521` → `too_large`; đúng 20 971 520 → POST |
| P47 | R24: job Orchestrator → không tạo `out/`, không POST; job agent → `out/` 0700 có trước khi CLI chạy |
| P48 | `#fake:need_input #fake:out=a.md` / job `failed` (`#fake:badjson=3`) / huỷ khi `#fake:sleep` → 0 POST |
| P49 | Thiếu `AGENT_RT_HUB_URL` + file `out/` → `warn job.outputs_skipped{reason:"no_hub_url"}`, job `succeeded`, không khoá `outputs` |
| P50 | Không file `out/` → `job.result` **không** khoá `outputs` (so với H2b); log `job.outputs` không tên file |

## 3. S · stack (`tests/acceptance/H2c/stack/*.stack.test.ts`) — QW-P, khoá Q3
Hub thật trên host (env `HUB_ATTACH_*` thư mục tạm, `HUB_MAX_CONCURRENT_RUNS=2`), Runtime container `fake-cli` (`AGENT_RT_HUB_URL=http://host.docker.internal:<hub>`), MK (`/files/upload`); harness theo H2b `_stack.ts` (TC-4, TC-5). Đỏ đúng lý do trước PY-03/04, B5/B6/B9.

| ID | File · Mã | Ca |
|---|---|---|
| S01 | `files.stack` · WRK-FR-11 · AC-07 | `lan` tải `a.pdf` + `b.md` → `@assistant #fake:files` + ids → content = `a.pdf:<sha>\nb.md:<sha>` (sha = Hub); `jobs.payload.prompt` có khối file |
| S02 | `files.stack` · WRK-BR-07 · AC-07 | Run 1 (`#fake:files`, có file) → run 2 cùng flow `@assistant #fake:read=../<job_id run 1>/attachments/a.pdf` → content `denied`; `#fake:read=attachments/a.pdf` → `read: N chars` (file của job hiện tại, R14) |
| S03 | `out.stack` · WRK-FR-18 · AC-12 | `@assistant #fake:out=report.md` → `run.finished`; tải lại lịch sử: tin assistant `attachments=[{filename:"report.md", mime:"text/markdown", available:true}]`; `/content` = `"fake output report.md\n"`. `#fake:out=a.exe,bad.pdf,b.md` (L7) → chỉ `b.md`, run `finished`. `#fake:out-link=x.md` → tin không khoá `attachments` |
| S04 | `out.stack` · R26 | `@assistant #fake:out=r.md #fake:sleep=10` → huỷ → `run.failed CANCELLED`, không hàng output nào gắn (0 hàng `origin='output'` có `message_id`) |
| S05 | `async-file.stack` · HUB-FR-12 · AC-10 | `/hoadon-async` + `hoadon.pdf` → MK: đúng **1** `/v1/files/upload` (Hub, trước `jobs.created_at`), `/v1/workflows/run` `inputs.file.upload_file_id` = id upload; run `finished` |
| S06 | `orchestrated.stack` · AC-H03 (L5) | `lan` tải `hoadon.pdf`, gửi `#fake:delegate=hoadon #fake:files kiểm tra hoá đơn đính kèm rồi tạo thẻ Trello nếu sai` + id → payload Orchestrator có `- hoadon.pdf (application/pdf, …)` trong `<attachments>`; step `delegate(hoadon)` → kết quả `hoadon.pdf:<sha đúng>`; `answer`; `step.started` có nhãn |
| S07 | `files.stack` · R18 | Tin 2 cùng flow (không file mới) `@assistant #fake:files` → job mới tải lại `A` vào `work/<job mới>/attachments`, content đúng sha |

## 4. SM · smoke `tests/smoke/h2c-live.test.ts` (`HUB_LIVE=1`, I2, không chặn, không khoá)
| ID | Ca |
|---|---|
| SM1 | `claude-sub`: `@assistant` + PDF 2 trang (mỗi trang một câu khác nhau) "nêu câu ở trang 2" → câu trả lời chứa câu trang 2 |
| SM2 | `claude-sub`: `@assistant` + PNG có chữ lớn → trả đúng chữ; Dify thật (nếu có app vô hại input `file`) `/files/upload` + một lần chạy, không thì ghi "bỏ qua" (M01) |
