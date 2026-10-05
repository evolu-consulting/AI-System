# runtimes/cli/files — file đính kèm và `out/` của job `agentic-cli` (WRK-FR-11, WRK-FR-18, WRK-BR-07)

Plan: `docs/specs/H2c-attachments/plan-runtime.md` §3–§5; luật thuần `rt §4`. Gọi từ `../job_run.py` (`_prepare_files` trước provider, `_close` sau drain) và `../runner.py`.

| File | Vai trò |
|---|---|
| `rules.py` | thuần: `valid_job_file_name`, `classify_fetch`, `backoff`, `pick_outputs` (≤ 5, sắp tên), `filename_header`, `classify_output`, `wants_outputs`, hằng khớp contract Hub |
| `dirs.py` | `prepare_job_dirs(work, job_id)` → `work/<job_id>/{attachments,out}` làm mới (symlink/file đặt sẵn ⇒ xoá, thư mục cũ của lần claim trước ⇒ `rmtree`); trả `DirId` (dev, ino) của `out/` |
| `fetch.py` | `fetch_attachments`: `GET /internal/jobs/:id/attachments/:att` (Bearer token job), `O_EXCL\|O_NOFOLLOW`, kiểm size + sha256, `fchmod 0o400`; thử lại 5xx/mạng; lỗi ⇒ xoá file đã ghi, job `failed` reason `attachment` |
| `outputs.py` | `send_outputs`: mở `out/` bằng `O_DIRECTORY\|O_NOFOLLOW` + so `DirId`, mỗi file `POST /internal/jobs/:id/outputs` (`X-Filename` pct); không bao giờ làm job `failed` |

Phụ thuộc: `httpx2`, `sandbox/hook.py` (hook `Write` chỉ trong `out/`, PL9), `events/job_events.py` (`ResultMeta.outputs`).
Bẫy: không log token/tên file/URL; hook `Write` chỉ an toàn khi tool không tạo symlink (TOCTOU, docstring `outputs.py`); `work/<job_id>/` không tự dọn (TECH-DEBT #59); `ConnectionError` ⊂ `OSError` (#66); `DirId` có thể trùng khi inode tái dùng (#67).
Test: `tests/acceptance/{test_files_rules.py,attachments_int_test.py,outputs_int_test.py}` (khoá), `test_{dirs,fetch,outputs}.py` cạnh code.
