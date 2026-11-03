---
id: fix114-warm
lát: fix114-warm
cr: CR-114
làn: nhanh
migration: không
phụ thuộc: hub-warm-runtime
---
## Plan (ngắn)

Review CR-114 (Thấp): host `--warm` khởi động với `TMPDIR=work/.warm/.tmp`; `child.bind_warm` chỉ đổi `os.environ` ⇒ nếu
có import gọi `tempfile.gettempdir()` trước bind thì Python đã cache thư mục chung ⇒ file tạm của các job/tenant chung
một chỗ. Sửa: sau khi đổi env, `tempfile.tempdir = None` (lần gọi sau đọc lại TMPDIR của job).

## Làm

| # | Việc | Trạng thái |
|---|---|---|
| 1 | `runtimes/cli/child.py` `bind_warm`: xoá cache `tempfile.tempdir` sau `os.environ.update` | ✅ |
| 2 | `runtimes/cli/test_child_bind.py`: gọi `gettempdir()` trước bind (cache thư mục chung) → sau bind trỏ thư mục job, `NamedTemporaryFile` nằm trong đó | ✅ |

## Không làm / Chạm

Chỉ `child.py` + test mới.

## Test tối thiểu

`powershell deploy/evotest/run-tests.ps1 -Step py -Ref <commit> -Filter "src/agent_runtime/runtimes/cli/test_child_bind.py src/agent_runtime/runtimes/cli/test_warm_host.py"`.

## Quyết định trong lúc làm

- Đặt `tempfile.tempdir = None` (không gán thẳng): `gettempdir()` tự đọc lại `TMPDIR` của job và vẫn kiểm thư mục ghi được.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED hub/agent-runtime.md
#### Yêu cầu: Thư mục tạm riêng của job khi dùng host dựng sẵn
Host dựng sẵn gắn job thì mọi file tạm (`tempfile`) nằm trong `work/<job_id>/.tmp`, kể cả khi thư mục tạm đã được tính
trước lúc gắn job.
- Kịch bản: khi `gettempdir()` đã được gọi trước bind thì sau bind nó trỏ thư mục tạm của job [test: apps/agent-runtime/src/agent_runtime/runtimes/cli/test_child_bind.py » test_cr114_bind_resets_cached_tempdir]

## Việc còn lại
