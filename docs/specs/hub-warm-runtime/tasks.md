---
id: hub-warm-runtime
lát: hub-warm-runtime
cr: CR-114
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)

Đo ở `docs/specs/chat-fast/tasks.md` (smoke SM1): claim → CLI sẵn sàng ≈ 7,4 s, delta đầu ≈ 9 s mỗi job, vì mỗi job
spawn một job host Python (`runtimes/cli/child.py`: khởi động Python + import pydantic/registry/`claude_agent_sdk`) rồi
SDK mới spawn Claude CLI. Lát này bỏ phần **Python + import** khỏi đường nóng: bể `RUNTIME_WARM_POOL` (mặc định 1,
0 = tắt) host `child --warm` dựng sẵn, đã import xong, chờ một dòng `ChildRequest` trên stdin. Claim → `HostProcess.spawn`
lấy một host từ bể (không có ⇒ spawn lạnh như cũ), bể dựng bù nền.

## Làm

| # | Việc | Trạng thái |
|---|---|---|
| 1 | `runtimes/cli/warm_pool.py`: logic bể thuần (fill/take/refill/drain/close, trần `size` + `mem_ok`, host chờ chết ⇒ gỡ + dựng bù, 3 lần chết liền ⇒ ngưng dựng) | ✅ |
| 2 | `runtimes/cli/warm_host.py`: spawn `child --warm` (group riêng, env tường minh, cwd/TMPDIR trung tính `work/.warm`, stderr `log/.warm/`), chờ dòng `WARM_READY` mới vào bể; discard = đóng stdin (con thoát êm) → quá hạn giết group; `mem_ok` đọc `MemAvailable` ≥ 512 MB | ✅ |
| 3 | `child.py --warm`: báo sẵn sàng, đọc request, `WarmBind` ⇒ `chdir work/<job_id>`, env job (chỉ `TMPDIR`, `MCP_TOOL_TIMEOUT`), `dup2` stderr → log job; stdin EOF khi chưa có job ⇒ thoát 0 | ✅ |
| 4 | `host_proc.py`: `spawn` lấy host từ bể (`cfg.warm`), gửi `ChildRequest.warm`; còn lại (pgid, giám sát, giết group, dọn) giữ nguyên | ✅ |
| 5 | `queue/orphans.py`: nhận host `--warm` theo cwd `…/<job_id>` (không có `--job-id` trong cmdline) | ✅ |
| 6 | `config.py` `RUNTIME_WARM_POOL` (0–4, mặc định 1); `main.start_queue` dựng bể sau "sẵn sàng"; `QueueRuntime.shutdown` đóng bể trước khi dừng job | ✅ |
| 7 | Test: `test_warm_pool.py` (9 ca), `test_warm_host.py` (process thật + số đo), `queue/test_orphans_warm.py` | ✅ |

## Không làm / Chạm

- Không chạm `queue/claimer.py` (SQL claim — lát khác). Tích hợp ở mức host (`HostProcess.spawn`).
- **Không giữ CLI ấm / không dùng lại process giữa job:** tuỳ chọn CLI (system prompt, model, tool, `cwd`, MCP + token
  claim, hook sandbox theo `forbidden_roots`) đều phụ thuộc job ⇒ CLI chỉ khởi động được sau khi có job; SDK không bảo
  đảm trạng thái sạch khi tái dùng ⇒ host chỉ dùng **một lần** rồi bỏ (đúng yêu cầu cách ly). Phần CLI start (1,1–6,7 s)
  vì vậy vẫn còn.
- Bể không chia theo agent type: host chưa gắn job là trung tính (cùng registry provider), nên một bể chung là đủ.

## Test tối thiểu

- Unit (`apps/agent-runtime`, chạy trên máy chủ evotest bằng venv `uv sync --frozen` riêng — máy Windows không chạy
  được job host Linux): `uv run pytest -m "not int" src` → **693 passed, 1 failed** — ca đỏ
  `runtimes/cli/test_confirm.py::test_hub_fr_95_model_need_input_kept` đỏ y hệt trên ref gốc `a4a95d93` (có sẵn, không do
  lát); ruff/format/pyright file đổi sạch (trừ `main.py` PLR0913 `make_router` có sẵn), `lint-imports` 6 kept.

## Số đo (trước → sau)

`test_warm_host.py » test_cr114_measure_cold_vs_warm_first_event` (evotest, Python 3.13, provider `fake-cli`, median 3 lượt):
từ lúc có job tới **sự kiện đầu tiên** của job host:

| | Spawn lạnh (trước) | Host dựng sẵn (sau) |
|---|---|---|
| có job → sự kiện đầu | **1044 ms** (1028 / 1044 / 1052) | **1 ms** (1 / 1 / 1) |
| 2 lượt chạy lại (median) | 869 ms · 1032 ms | 1 ms · 1 ms |

⇒ claim → delta đầu giảm ≈ **1,0 s mỗi job** (≈ 11 % của 9 s SM1; với Orchestrator 2 job ⇒ ≈ 2 s mỗi tin). Phần còn
lại của 7,4 s là CLI start (1,1–6,7 s) — không cắt được an toàn ở Runtime (xem "Không làm").

## Quyết định trong lúc làm

- Host chỉ dùng một lần, không trả về bể (cách ly như spawn lạnh; không cần SDK bảo đảm trạng thái sạch).
- Orphan: host `--warm` không có `--job-id`; gắn job thì `chdir work/<job_id>` ⇒ `orphans.is_job_host` nhận theo tên cwd
  (cũng nhận `(deleted)`), spawn lạnh giữ luật cũ. Khe giữa `take` và `chdir` (vài ms) không nhận — cha chết khi đó ⇒
  stdin EOF ⇒ con tự thoát.
- Trần: `RUNTIME_WARM_POOL` ≤ 4 và không dựng khi `MemAvailable` < 512 MB; mỗi host chờ ≈ một process Python đã import
  SDK. Không tính vào `RUNTIME_SANDBOX_MAX` (đó là slot container tự-sửa, không phải job host).
- Manifest `agent_types` chỉ ghi lúc khởi động (từ code) ⇒ đổi manifest = deploy = khởi động lại ⇒ `shutdown` đóng bể
  (`drain`), host chờ còn sót nhận EOF stdin khi cha chết. `WarmPool.drain()` có sẵn cho nguồn đổi cấu hình sau này.
- Dòng `WARM_READY` chỉ `spawn_warm` đọc (không phải `ChildEvent`), để bể chỉ chứa host đã import xong.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED hub/agent-runtime.md
#### Yêu cầu: Bể job host dựng sẵn (`RUNTIME_WARM_POOL`)
Agent Runtime giữ sẵn tối đa `RUNTIME_WARM_POOL` (0–4, mặc định 1; 0 = tắt) job host Python đã import provider/SDK;
job `agent.cli` được claim dùng một host trong bể (mỗi host đúng một job, không dùng lại giữa job/tenant), bể dựng bù
nền; hết bể hoặc bể tắt ⇒ spawn lạnh như cũ. Không dựng thêm khi RAM trống < 512 MB; host chờ chết 3 lần liền ⇒ ngưng.
- Kịch bản: khi bể có host thì job lấy host đó và chạy hết tới `final` [test: apps/agent-runtime/src/agent_runtime/runtimes/cli/test_warm_host.py » test_cr114_host_process_uses_warm_host]
- Kịch bản: khi lấy một host thì host đó rời bể và bể dựng host mới thay (không trao lại host cũ) [test: apps/agent-runtime/src/agent_runtime/runtimes/cli/test_warm_pool.py » test_cr114_take_is_single_use_and_refills]
- Kịch bản: khi host chờ chết thì bể gỡ nó và dựng bù; chết liền 3 lần thì bể ngưng, job spawn lạnh [test: apps/agent-runtime/src/agent_runtime/runtimes/cli/test_warm_pool.py » test_cr114_idle_crash_removed_and_refilled; apps/agent-runtime/src/agent_runtime/runtimes/cli/test_warm_pool.py » test_cr114_crash_loop_disables_pool]
- Kịch bản: khi bể drain (dừng process / đổi cấu hình) thì host chờ và host đang dựng dở đều bị huỷ [test: apps/agent-runtime/src/agent_runtime/runtimes/cli/test_warm_pool.py » test_cr114_drain_discards_idle_and_inflight]
- Kịch bản: khi RAM trống thấp hoặc `RUNTIME_WARM_POOL=0` thì không dựng host nào [test: apps/agent-runtime/src/agent_runtime/runtimes/cli/test_warm_pool.py » test_cr114_low_memory_skips_spawn; apps/agent-runtime/src/agent_runtime/runtimes/cli/test_warm_pool.py » test_cr114_disabled_when_size_zero]
- Kịch bản: khi job host dựng sẵn bị bỏ lại (heartbeat/sweeper) thì dọn group theo cwd `work/<job_id>` như job host thường [test: apps/agent-runtime/src/agent_runtime/queue/test_orphans_warm.py » test_cr114_orphan_check_warm_by_cwd]
- Kịch bản: khi gắn job mà env gửi kèm ngoài danh sách trắng thì host từ chối (fatal, thoát 2) [test: apps/agent-runtime/src/agent_runtime/runtimes/cli/test_warm_host.py » test_cr114_warm_host_bad_bind_env_refused]

## Việc còn lại

- Đo thật trên sohoptac2 sau deploy (câu SQL `docs/specs/chat-fast/tasks.md` §5 + log `job.warm_host`): kỳ vọng
  claim → delta đầu giảm ≈ 1 s/job.
- CLI start (1,1–6,7 s) còn lại: chỉ cắt được nếu SDK/CLI cho cấu hình sau khi khởi động — để CR sau.
- Bộ int/e2e cuối đợt (Luật 0b).
