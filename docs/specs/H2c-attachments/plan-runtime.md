# Plan · H2c · Agent Runtime Python (`apps/agent-runtime`)

Luật: spec R15–R19, R24, R25 (WRK-FR-11, WRK-FR-18, WRK-BR-06, WRK-BR-07). Hub: `plan.md` §5.3–5.5. Nền: H1 `plan-runtime` (sandbox §5.1, `JobRun` §2.3), H2a `plan-runtime` §3.3 (token job, `make_hub_client`), H2b `plan-runtime` (DeltaPump). Không thư viện mới (`httpx2` ADR-0010, stdlib `os`/`hashlib`/`urllib.parse`).

## 1. Tổng quan thay đổi
| File | Việc |
|---|---|
| `contracts/hub.py` (sinh, C2) | `JobPayload1.attachments: list[JobAttachment] \| None`, `JobFailReason` + `attachment`, `JobResultEvent.outputs`, `WorkflowInputValue` + object file, model `JobOutputResponse` |
| `runtimes/hub_http.py` (mới) | chuyển `make_hub_client`, `NO_PROXY_MOUNTS`, `CREDENTIAL_TIMEOUT` từ `runtimes/dify/credential.py` (file cũ import lại và **giữ tên export** — test dify import theo đường dẫn cũ); `runtimes.cli` và `runtimes.dify` cùng dùng (hợp contract `independence`) |
| `runtimes/cli/files/rules.py` (mới, thuần) | §4 — qc viết unit trước |
| `runtimes/cli/files/dirs.py` (mới) | `prepare_job_dirs(work, *, attachments: bool, out: bool)` (§3.1) |
| `runtimes/cli/files/fetch.py` (mới) | `fetch_attachments(...)` (§3.2) |
| `runtimes/cli/files/outputs.py` (mới) | `send_outputs(...)` (§5) |
| `runtimes/cli/job_run.py` | `_prepare_files()` đầu `_execute`; `_close` gọi `send_outputs` khi thành công (§3.3, §5) |
| `runtimes/cli/outcome.py` | `Verdict.outputs: tuple[str, ...] = ()` |
| `runtimes/cli/runner.py` · `events/job_events.py` | `events.result(job, output, usage, resumed, outputs=())` — khoá `outputs` **chỉ khi** ≠ ∅ |
| `providers/fake/{directives,files}.py` | `#fake:files`, `#fake:out`, `#fake:out-size`, `#fake:out-link` (§6) |
| `sandbox/**` | **không đổi** (R18): `attachments/`, `out/` nằm dưới `work/<job_id>/` ⇒ hook `realpath` cho phép; job khác ⇒ `other_job` |

## 2. Payload, cấu hình
- `payload.attachments` vắng/`None`/`[]` ⇒ không tải (H2b y hệt). Có ⇒ tải **bất kể** vai (Hub chỉ gửi cho job agent, R15).
- `out/` chỉ khi `payload.agent.role == "agent"` (R24). Câu nhắc `out/` và khối file do **Hub** nối vào `system_prompt`/`prompt` (PL4) — Runtime **không** sửa prompt.
- `AGENT_RT_HUB_URL` (đã có, `Settings.hub_url`): không bắt buộc lúc khởi động khi không có `dify`; job có `attachments` mà vắng ⇒ `failed` `attachment` (`no_hub_url`); `out/` có file mà vắng ⇒ bỏ gửi + `warn job.outputs_skipped reason=no_hub_url`, job vẫn `succeeded`.

## 3. Tải file (R16)
### 3.1 Thư mục (`dirs.py`) — trước khi tải, trước `_attempt`
`prepare_job_dirs(work, attachments=bool(items), out=role=="agent")`: `work` `mkdir(0o700, parents, exist_ok)`; với mỗi `sub ∈ {attachments, out}` cần dùng: `lstat` — là symlink/file ⇒ `unlink`; là thư mục (lần claim trước của **cùng** `job_id`, requeue H2b) ⇒ `shutil.rmtree` (không theo symlink — Python 3.12 dùng fd); rồi `mkdir(0o700)` và kiểm lại `lstat` là thư mục thật. Lỗi OS ⇒ `failed attachment` (`why=path`).

### 3.2 `fetch_attachments(client, hub_url, job, items, dest, *, deadline, stop) -> FetchResult`
`FetchResult = FetchOk(count, bytes, ms) | FetchFailed(why: FetchWhy, attachment_id) | FetchStopped | FetchTimedOut`; `FetchWhy = Literal["no_hub_url","bad_name","path","exists","unauthorized","not_found","http","size_mismatch","sha_mismatch","network"]`. Tuần tự, theo thứ tự payload. Mỗi file:
1. `valid_job_file_name(name)` sai ⇒ `bad_name`. `target = dest / name`; `realpath(target.parent) == realpath(dest)` sai ⇒ `path`.
2. `fd = os.open(target, O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC, 0o600)`; `FileExistsError`/`ELOOP` ⇒ `exists` (symlink đặt sẵn — AC-08).
3. `GET {hub_url}/internal/jobs/{quote(job.id)}/attachments/{quote(id)}`, `Authorization: Bearer <job.token>`, `client.stream`, chunk 64 KiB → `os.write` + `hashlib.sha256` + đếm; đếm > `size` ⇒ huỷ, `size_mismatch`. Hết thân: đếm ≠ `size` ⇒ `size_mismatch`; hex ≠ `sha256` (payload là chuẩn; `X-Content-SHA256` chỉ đối chiếu thêm) ⇒ `sha_mismatch`.
4. `classify_fetch(status)` (§4): `retry` ⇒ đóng + `unlink` file dở, chờ `backoff(k)` (1 s, 3 s), mở lại `O_EXCL`; hết lượt ⇒ `network`/`http`. `unauthorized`/`not_found`/`http` ⇒ không thử lại.
5. Xong: `os.fchmod(fd, 0o400)`, đóng.
- Hạn: mỗi lần thử `asyncio.timeout(min(FETCH_TIMEOUT_S, deadline − now))`; hết 60 s ⇒ coi như lỗi mạng (thử lại); chạm `deadline` của job ⇒ `FetchTimedOut`. `stop` (cancel/shutdown) set ⇒ huỷ ngay ⇒ `FetchStopped`.
- `FetchFailed`/`FetchStopped`/`FetchTimedOut` ⇒ xoá **mọi** file đã ghi trong `dest` (kể cả file dở).
- Không log token, tên file, URL đầy đủ; log `job.attachment_failed{attachment_id, why, status}`; xong `job.attachments_fetched{count, bytes, ms}`.

### 3.3 Nối vào `JobRun`
```python
async def _execute(self) -> None:
    if not await self._prepare_files():   # mới — trước _load_session
        return
    await self._load_session() ...        # như H2b
```
`_prepare_files` → `FetchOk` ⇒ True · `FetchFailed` ⇒ `await self.host.finish_failed(self.job, Failure("failed", "INTERNAL_ERROR", "attachment", f"attachment fetch failed: {why}"))` (không usage, không đụng provider) ⇒ False · `FetchTimedOut` ⇒ `_close(Verdict(TIMED_OUT))` ⇒ False · `FetchStopped` ⇒ như `_apply` `stopped` (cancel ⇒ `_close(Verdict(CANCELLED))`; shutdown ⇒ `job.stopped_no_write` + `events.forget`) ⇒ False. Lần thử lại trong cùng claim (resume hỏng, JSON hỏng) **không** tải lại.

## 4. Luật thuần — `runtimes/cli/files/rules.py` (qc unit `tests/acceptance/test_files_rules.py`)
| Chữ ký | Luật |
|---|---|
| `JOB_FILE_NAME_MAX_BYTES = 120` · `ATTACH_MAX_BYTES = 20_971_520` · `OUT_MAX_FILES = 5` · `FETCH_TIMEOUT_S = 60.0` · `FETCH_BACKOFF_S = (1.0, 3.0)` | hằng (khớp contract) |
| `valid_job_file_name(name: str) -> bool` | True ⇔ `name.encode("utf-8")` không lỗi và 1–120 byte ∧ `unicodedata.normalize("NFC", name) == name` ∧ `name not in {".", ".."}` ∧ ký tự đầu ∉ `.-` ∧ mọi ký tự `c.isalnum() or c in " ._-"` (⇒ không `/`, `\`, NUL, điều khiển). Mọi `safeName` của Hub (plan-rules §1) thoả |
| `classify_fetch(status: int \| None) -> Literal["ok","retry","unauthorized","not_found","http"]` | `None` (mạng/timeout) → `retry` · 200 → `ok` · 401 → `unauthorized` · 404 → `not_found` · ≥ 500 → `retry` · khác → `http` |
| `backoff(attempt: int) -> float \| None` | 0 → 1.0 · 1 → 3.0 · ≥ 2 → None (tối đa 3 lần gửi) |
| `@dataclass(frozen) OutEntry(name: str, kind: Literal["file","symlink","dir","other"], size: int)` · `OutSkip = Literal["symlink","dir","other","empty","too_large","bad_name","over_limit"]` | — |
| `pick_outputs(entries: Iterable[OutEntry]) -> tuple[list[OutEntry], list[OutSkip]]` | Loại theo thứ tự: `kind ≠ file` → `symlink`/`dir`/`other`; `size == 0` → `empty`; `size > ATTACH_MAX_BYTES` → `too_large`; `name` không mã hoá UTF-8 được (surrogateescape) hoặc chứa `/`, `\`, NUL → `bad_name`. Còn lại sắp theo `name` (so code point), lấy 5 đầu, phần sau → `over_limit` (một mục mỗi file) |
| `filename_header(name: str) -> str` | `urllib.parse.quote(name, safe="")` (UTF-8, khớp `parseFilenameHeader` Hub) |
| `classify_output(status: int \| None) -> Literal["ok","skip","retry","stop"]` | 201 → `ok` · 400/409/413/415 → `skip` · 401 → `stop` (ngừng gửi phần còn lại) · `None`/≥ 500 → `retry` (dùng `backoff`) · khác → `skip` |
| `wants_outputs(role: str, output: Mapping[str, Any] \| None) -> bool` | `role == "agent"` ∧ `output["kind"] == "agent_result"` ∧ `output["result"]["status"] ∈ {"done","partial"}` (R25) |

## 5. `out/` → Hub (R25) — `outputs.py`
- Khi: `JobRun._close(v)` với `v.failure is None` ∧ `wants_outputs(role, v.output)`; thứ tự: `pump.drain()` → **`send_outputs`** → `FinishTx`/`host.close` (XADD `job.result{…, outputs}`). Job lúc này vẫn `running` trong DB (Hub đòi, R17/R25).
- Liệt kê: `os.scandir(out)` (`is_symlink()`, `is_file(follow_symlinks=False)`, `stat(follow_symlinks=False).st_size`) → `OutEntry` → `pick_outputs`. Mỗi file chọn: `realpath(path).parent == realpath(out)` (phòng thủ) → `os.open(O_RDONLY|O_NOFOLLOW|O_CLOEXEC)` → `fstat` (thường, size khớp, ≤ max — lệch ⇒ bỏ `too_large`/`other`).
- Gửi: `POST {hub_url}/internal/jobs/{id}/outputs`, `Authorization: Bearer <token>`, `X-Filename: filename_header(name)`, `Content-Type: application/octet-stream`, `Content-Length: size`, thân stream từ fd; `asyncio.timeout(60)` mỗi lần; `classify_output`: `ok` ⇒ `JobOutputResponse.model_validate_json` → id (thân sai ⇒ bỏ); `skip` ⇒ bỏ file; `stop` ⇒ ngừng; `retry` ⇒ ≤ 2 lần nữa.
- Kết quả: `tuple(ids)` (≤ 5) ⇒ `Verdict.outputs`. Không bao giờ làm job `failed`. Huỷ (cancel) trong lúc gửi ⇒ ngừng gửi, giữ id đã có, tiếp `_close`.
- Log `job.outputs{sent, skipped, ms}`, `job.output_skipped{why, status}` (không tên file).

## 6. `fake-cli` (R19; `providers/fake/files.py`, đăng ký trong `directives.py`)
| Chỉ thị | Hành vi |
|---|---|
| `#fake:files` | kết quả `done`, `text` = các dòng `<name>:<sha256 hex>` của file thường trong `work/attachments/` sắp theo tên, nối `\n`; thư mục vắng/rỗng ⇒ `(no files)` |
| `#fake:read=<path>` | có sẵn (H1): qua `_guarded` ⇒ `../<job khác>/attachments/x` bị hook chặn (AC-07) |
| `#fake:out=<a>[,<b>…]` | trước kết quả: ghi `out/<tên>` nội dung `fake output <tên>\n` (UTF-8); tên chứa `/` hoặc `\` ⇒ bỏ; tối đa 10 tên |
| `#fake:out-size=<n>` | đi kèm `#fake:out`: nội dung = `n` byte `a` (0 ≤ n ≤ 20 971 521) |
| `#fake:out-link=<tên>` | tạo symlink `out/<tên>` → `/etc/hostname` (AC-12: bị bỏ) |
Chỉ thị khác (H1–H2b) giữ nguyên; kết hợp được (`#fake:files #fake:out=report.md`).

## 7. Env
Không env mới. `.env.example` ghi chú: `AGENT_RT_HUB_URL` cần cho job có file/`out/`.

## 8. Test và giả lập (qc)
| Lớp | File | Nội dung |
|---|---|---|
| Unit thuần (QW-PU, khoá trước PY-01) | `tests/acceptance/test_files_rules.py` | §4 mọi hàm; mẫu tên giống bảng AC-04 Hub |
| Mock Hub | `tests/support/hub_files_mock.py` (mới, cùng kiểu `dify_mock.py`) | `GET …/attachments/:id` + `POST …/outputs`; chỉ thị theo `attachment_id`: `sha-wrong`, `short`, `5xx-once`, `401`, `404`, `slow`; ghi lại header (`Authorization`, `X-Filename`) |
| Python int (QW-P) | `tests/acceptance/attachments_int_test.py` · `outputs_int_test.py` | AC-08 (sha sai, thiếu byte, `name` có `..`, symlink đặt sẵn, 5xx một lần → thành công, `no_hub_url`) · AC-12 phía Runtime (symlink, 6 file → 5, `.exe`/415 → bỏ, job `succeeded`; `outputs` trong `job.result`) · perf 10 × 2 MiB ≤ 2 s · requeue cùng `job_id` ⇒ thư mục làm mới |
| Stack (QW-P) | `tests/acceptance/H2c/stack/*` | AC-07, AC-10, AC-12, AC-H03 (Hub thật + Runtime thật + `fake`) |
| Unit dev (PY-*) | `runtimes/cli/files/test_*.py` | `dirs`, `fetch` (transport giả `httpx2.MockTransport`), `outputs` |

## 9. Đối chiếu Hub ↔ Runtime
✓ = khớp `plan.md` · ✗ = đã sửa, theo cột "Chốt".
| # | Chủ đề | Hub (`plan.md`) | Runtime (file này) | | Chốt |
|---|---|---|---|---|---|
| F1 | Payload file | `attachments?` chỉ khi `A ≠ ∅`, ≤ 10, `name` = `jobFileNames` (≤ 120 byte) | vắng/`[]` ⇒ không tải; `valid_job_file_name` kiểm lại | ✓ | Regex contract không lookahead (pydantic-core) |
| F2 | URL + auth tải | `GET /internal/jobs/:job_id/attachments/:id`, token job, 401 một thân | Bearer `job.token` (token của lần claim hiện tại) | ✓ | Requeue ⇒ token mới, Hub tra `token_hash` hiện hành |
| F3 | Toàn vẹn | `Content-Length`, `X-Content-SHA256` | so `size`/`sha256` của **payload** | ✓ | Payload là chuẩn |
| F4 | File đã xoá | 404 `NOT_FOUND` | `not_found` ⇒ không thử lại ⇒ `failed attachment` | ✓ | — |
| F5 | Lỗi tải | `job.failed reason=attachment` ⇒ `run.failed INTERNAL_ERROR` (câu H1) | `Failure("failed","INTERNAL_ERROR","attachment",…)` qua `finish_failed` | ✓ | CHECK `jobs_error_reason_check` + `attachment` (D1) |
| F6 | Prompt | Hub nối khối file vào `prompt`, câu `out/` vào `system_prompt` | không sửa prompt | ✗ | Spec R24 ghi "Runtime … prompt thêm câu" mơ hồ ⇒ chốt Hub (PL4) |
| F7 | `out/` | chỉ job agent | chỉ `role == "agent"` | ✓ | — |
| F8 | Gửi output | `POST …/outputs` thân thô + `X-Filename` pct; 400/409/413/415; > 5/job ⇒ 409 | `filename_header`; `skip`/`stop`/`retry` (§4) | ✓ | — |
| F9 | Thời điểm | job còn `running` | gửi trước `FinishTx` | ✓ | — |
| F10 | `job.result.outputs` | `.min(1).max(5).optional()`; gắn theo DB (`bindOutputs`), `outputs` chỉ để trace | khoá chỉ khi ≠ ∅ | ✓ | — |
| F11 | Output trùng khi requeue | `DISTINCT ON (job_id, safe_name)` lấy bản mới (PL6) | thư mục `out/` làm mới khi claim lại | ✓ | — |
| F12 | `workflow.async` có file | Hub upload Dify trước enqueue, `inputs` mang object | gửi nguyên `inputs` (`_inputs` không đổi); không gọi `/files/upload` | ✓ | T7 |
| F13 | Thiếu `AGENT_RT_HUB_URL` | — | tải ⇒ `failed`; out ⇒ bỏ + `warn` | ✓ | — |
| F14 | `fake` | — | §6 | ✓ | `tools/hub-dev/src/dify-mock.ts` (khoá) — qc thêm `/files/upload` |
| F15 | AC-08 "`name` có `..`" | contract `JobAttachment.name` cấm `/`, `\`, `.` đầu ⇒ Hub không thể gửi | payload sai hình ⇒ `invalid_payload` (H1) trước khi tải; `bad_name` (`attachment`) là lớp phòng thủ thứ hai | ✗ | AC-08 vế tên: qc kiểm ở unit `fetch_attachments` (gọi thẳng với mục dựng tay) + int payload `../x` ⇒ `failed invalid_payload`, không file nào ghi |

## 10. TECH-DEBT
TD #59 (ghi `docs/TECH-DEBT.md` ở PLAN): `work/<job_id>/` (kể cả `attachments/`, `out/`) **không được dọn** sau job (hiện trạng H1) ⇒ file khách hàng nằm lại trên máy Runtime vô thời hạn. Đề xuất: dọn `work/<job_id>` khi job kết thúc (trừ `logs`), hoặc container mỗi job (WRK-NFR-02). Ngoài phạm vi H2c (spec K7).

## 11. Task PY: `tasks.md` khối PY.
