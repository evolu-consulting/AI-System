# Hub · Agent Runtime · host dựng sẵn

Cập nhật: 2026-11-09 · Gộp từ: fix114-warm, hub-warm-runtime (đợt cr125-wave).

## Yêu cầu: Thư mục tạm riêng của job khi dùng host dựng sẵn (nguồn: fix114-warm)
Host dựng sẵn gắn job thì mọi file tạm (`tempfile`) nằm trong `work/<job_id>/.tmp`, kể cả khi thư mục tạm đã được tính
trước lúc gắn job.
- Kịch bản: khi `gettempdir()` đã được gọi trước bind thì sau bind nó trỏ thư mục tạm của job [test: apps/agent-runtime/src/agent_runtime/runtimes/cli/test_child_bind.py » test_cr114_bind_resets_cached_tempdir]

## Yêu cầu: Bể job host dựng sẵn (`RUNTIME_WARM_POOL`) (nguồn: hub-warm-runtime)
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
