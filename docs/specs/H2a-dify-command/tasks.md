# Tasks · H2a-dify-command

Mỗi task: một commit `[FR]`, diff ≈ ≤ 400 dòng. Tick khi lệnh "xong" xanh. `blocked` kèm lý do → báo cáo cuối.
Cột `Đọc`: đúng các mục tài liệu task cần (agent BUILD chỉ đọc chừng đó + bàn giao). Cột `Rủi ro` (`cao` / `thường`) quyết định model khi BUILD — `docs/WORKFLOW.md` "Chính sách model".

<!-- Khung do docs-architect (2026-10-05). backend-lead sửa khi viết `plan.md` (BE TS) ∥ `plan-runtime.md` (Python); số `plan §` điền sau. Không có frontend (spec §5).
Nhóm: Tiền đề · DB · Contract · BE-TS (hub-api) · PY (agent-runtime) · QA. `BA-H` = ba-agent-hub.md, `BA-W` = ba-worker.md. Lệnh Python chạy trong `apps/agent-runtime`. -->

## Thứ tự (đề xuất, backend-lead chốt ở plan)
1. Gate → C1, D1, PY-00 (tách `job_run.py`) → B0 (stub chữ ký).
2. qc WRITE theo nhóm → khoá `tests/.lock`.
3. Sau khoá: D2, C2, B1–B9, PY-01–PY-04.
4. I1 (`done:h2a`) → I2 (smoke `DIFY_LIVE=1` + `HUB_LIVE=1`, `blocked` tới khi người dùng có Dify thật) → I3 (docs).

| # | Task | Agent | Rủi ro | Đọc | File | Phụ thuộc | Lệnh xong | Trạng thái |
|---|---|---|---|---|---|---|---|---|
| **Tiền đề** | | | | | | | | |
| W1 | Người dùng (tuỳ chọn): Dify thật + workflow mẫu + secret nhập ở Admin cho smoke | người dùng | thường | `spec §7`, `§9 Q10` | máy (không repo) | — | smoke I2 chạy được | [ ] |
| B0 | Stub chữ ký sau Gate (hàm thuần parse/map/quyền/gợi ý/ánh xạ lỗi Dify, MCP handler, confirmation) | backend-lead | thường | `plan §…` | `apps/hub-api/src/modules/{commands,dify,mcp}/` | Gate | `bun run typecheck` | [ ] |
| **DB** | | | | | | | | |
| D1 | Migration hub: `runs.kind/command_id/feature_id`, `run_steps.type/workflow_id`, `jobs.type workflow.async` + token MCP hash, `tool_confirmations` (+ RLS) | backend-lead | cao | `spec §4`, `§2 R13, R18, R21–R22`, `H1 plan-db.md` | `packages/db/migrations-hub/`, `packages/db/src/schema/hub.ts` | Gate | `bun run test:int packages/db` | [ ] |
| D2 | Quyền đọc `admin.*` cho `hub_ro` (catalog + cột bản mã `admin.secrets`, Q1) + test không lộ cột khác | backend-lead | cao | `spec §4`, `§9 Q1`, `M2 plan §3.1–3.2` | `packages/db/migrations-hub/` | D1 | `bun run test:int packages/db` · test int Admin xanh | [ ] |
| D3 | Seed yaml: agent `dify-*`, `agent_workflows`, `workflow_flags` + validate | backend-lead | thường | `spec §2 R14, R23`, `H1 plan §3.6` | `apps/hub-api/seed/*.yaml`, `apps/hub-api/src/modules/seed/` | D1 | `bun run test:int apps/hub-api/src/modules/seed` | [ ] |
| **Contract** | | | | | | | | |
| C1 | `@ai/contracts/chat-ext` (`CommandMenuItem`, `SendMessageRequestExt`, `CMD_NOT_FOUND`, `CMD_MISSING_ARG`) — không sửa `chat` | backend-lead | cao | `spec §3`, `§9 Q3`, `C1 spec §3` | `packages/contracts/src/chat-ext/*`, `packages/contracts/package.json` | Gate | `bun test packages/contracts/src/chat-ext` | [ ] |
| C2 | `@ai/contracts/hub`: job `workflow.async`, `agent.cli.mcp`, sự kiện tiến độ; `contracts:gen` + `contracts:check` | backend-lead | cao | `spec §3`, `ADR-0009` | `packages/contracts/src/hub/*`, `apps/agent-runtime/contracts/*` | C1 | `bun run contracts:check` | [ ] |
| **BE-TS** | | | | | | | | |
| B1 | Cache catalog Admin + quyền command (hàm thuần tương đương M3 Kiểm tra quyền) | backend-lead | cao | `spec §2 R02, R03`, `apps/admin-api/src/modules/access/access.rules.ts` (chỉ đọc) | `apps/hub-api/src/modules/{config,commands}/` | D2 | `bun test` + int đối chiếu (HUB-H2a-AC-10) | [ ] |
| B2 | `GET /commands` | backend-lead | thường | `spec §2 R03`, `§3` | `apps/hub-api/src/modules/commands/` | B1, C1 | acceptance AC-H05, H11 | [ ] |
| B3 | Router `/` `//` + parse + input map + validate + gợi ý + lỗi pre-run | backend-lead | thường | `spec §2 R01, R04–R07, R16` | `apps/hub-api/src/modules/{runs,commands}/` | B1, C1 | unit HUB-H2a-AC-01 · acceptance AC-H01, H02, AC-09 | [ ] |
| B4 | Dify client TS (streaming SSE, stop, ánh xạ lỗi, usage) + giải mã secret | backend-lead | cao | `spec §2 R09–R11, R15, R17`, `M2 plan §3.2` | `apps/hub-api/src/modules/dify/` | D2 | int với mock Dify Hub (Q9) · HUB-H2a-AC-03, 04 | [ ] |
| B5 | Command Runner sync (run `kind=command`, snapshot, delta, timeout, cancel) | backend-lead | thường | `spec §2 R08–R10` | `apps/hub-api/src/modules/commands/` | B3, B4 | HUB-H2a-AC-02, 03 | [ ] |
| B6 | Command async: tạo job `workflow.async`, dịch tiến độ → step; endpoint lấy app-key cho job (Q5) | backend-lead | cao | `spec §2 R12, R13`, `§9 Q5` | `apps/hub-api/src/modules/{commands,runner}/` | B5, C2 | acceptance async · AC-W06 (phần TS) | [ ] |
| B7 | Runtime agent `dify-workflow` / `dify-agent` trong Orchestrator | backend-lead | thường | `spec §2 R14` | `apps/hub-api/src/modules/{orchestrator,dify}/` | B4, D3 | HUB-H2a-AC-07 | [ ] |
| B8 | MCP `/mcp` (token job, `tools/list`, `tools/call`) + payload `agent.cli.mcp` | backend-lead | cao | `spec §2 R18–R20`, `§9 Q7, Q8` | `apps/hub-api/src/modules/mcp/`, `modules/runner/` | B4, C2, D1 | HUB-H2a-AC-05 · AC-H12 | [ ] |
| B9 | Xác nhận `side_effect` (pending/confirmed/consumed) | backend-lead | cao | `spec §2 R21–R23` | `apps/hub-api/src/modules/mcp/`, `modules/runs/` | B8 | AC-H22 | [ ] |
| B10 | `POST /internal/test-run` | backend-lead | cao | `spec §2 R24` | `apps/hub-api/src/modules/internal/` | B5 | HUB-H2a-AC-08 | [ ] |
| **PY** | | | | | | | | |
| PY-00 | Tách `runtimes/cli/job_run.py` (398/400) → `job_run.py` (điều phối) + `host_proc.py` (`HostProcess`: spawn/giám sát/giết group) — không đổi hành vi, không sửa logic test | backend-lead | thường | `plan-runtime §2`, `H1 spec-decisions "Nợ chuyển TECH-DEBT"` | `apps/agent-runtime/src/agent_runtime/runtimes/cli/{job_run,host_proc}.py` | Gate | `pytest` + `pytest -m int` (310 ca H1) xanh · `lint-imports` · `check:size` | [ ] |
| PY-S1 | Spike MCP với CLI thật trong WSL (10 điểm `plan-runtime §4.6`, server MCP giả stdlib, ≤ 6 lượt model) → `spike-mcp.md`; không sửa `src/**` | backend-lead | cao | `plan-runtime §4`, `H1 spike-py02.md` (S3) | `apps/agent-runtime/spikes/mcp_spike.py`, `docs/specs/H2a-dify-command/spike-mcp.md` | Gate | biên bản 10 điểm | [ ] |
| PY-01 | Lõi thuần `workflow.async`: `stream.reduce` (workflow/chat), `policy` (retry §3.4, ánh xạ lỗi R11, usage R15, `mask`) + unit bảng ca | backend-lead | cao | `plan-runtime §3.2, §3.4, §3.5, §3.7`, `spec §2 R11, R13, R15` | `apps/agent-runtime/src/agent_runtime/runtimes/dify/{stream,policy}.py` | C2 | `pytest src/agent_runtime/runtimes/dify` | [ ] |
| PY-02 | HTTP: thêm `httpx2` (ADR-0010), `DifyClient` (SSE, stop), `fetch_credential` (Q5, che key), env `AGENT_RT_HUB_URL`/`DIFY_*`, logger httpx2 `WARNING`; mock `tests/support/dify_mock.py` (Dify + credential) | backend-lead | cao | `plan-runtime §3.2, §3.3, §7, §8`, `ADR-0010`, `spec §2 R17` | `apps/agent-runtime/{pyproject.toml,uv.lock}`, `src/agent_runtime/{runtimes/dify/{client,credential}.py,config.py,log.py}`, `tests/support/dify_mock.py` | PY-01, B6 (hình endpoint) | unit `MockTransport` · `uv sync --frozen` | [ ] |
| PY-03 | `DifyJobHost` + `JobRouter` + `main`: vòng thử/backoff, `mark_dispatched`, `job.progress`, huỷ/timeout + stop, kết thúc + usage `billing=dify`, requeue orphan (`requeued`) | backend-lead | cao | `plan-runtime §3.1, §3.4–3.8`, `§9 R4, R7, R8`, `H1 plan-db.md §5.4–5.5` | `apps/agent-runtime/src/agent_runtime/{runtimes/dispatch.py,runtimes/dify/host.py,db/workflow_sql.py,db/jobs_sql.py,main.py}`, `pyproject.toml` (import-linter) | PY-02, D1 | `pytest -m int` HUB-H2a-AC-06, AC-04 (phần Runtime), AC-W06 | [ ] |
| PY-04 | MCP vào Claude Agent SDK: `providers/claude/mcp.py` (file cấu hình 0600 ngoài work, `allowed_tools` `mcp__hub__*`, `MCP_BLOCK`), hook `SandboxPolicy.mcp_tools`, `ChildRequest.mcp_config_path`; giữ `strict_mcp_config` + `ENABLE_CLAUDEAI_MCP_SERVERS=false` | backend-lead | cao | `plan-runtime §4.1–4.5`, `spike-mcp.md`, `spec §2 R18, R19` | `apps/agent-runtime/src/agent_runtime/{providers/claude/{mcp,options}.py,sandbox/hook.py,runtimes/cli/{host_proc,protocol}.py}` | PY-00, PY-S1, C2 | unit hook/options · `pytest -m int` | [ ] |
| PY-05 | `side_effect` phía agent: `mapping` → `Confirm`, `result.build_output` ép `need_input`, không retry sau `Confirm` | backend-lead | cao | `plan-runtime §5`, `§9 R6`, `spec §2 R21` | `apps/agent-runtime/src/agent_runtime/{providers/base.py,providers/claude/mapping.py,runtimes/cli/{result,job_run}.py}` | PY-04 | unit `test_hub_fr_95_*` | [ ] |
| PY-06 | `fake-cli`: `#fake:tool=<key>` gọi `/mcp` thật khi key ∈ `payload.mcp.tools` (giữ nghĩa H1 khi không), `#fake:args`, `#fake:mcp-list`, `CONFIRMATION_REQUIRED` → `need_input`; mock `tests/support/mcp_mock.py` | backend-lead | thường | `plan-runtime §6`, `H1 plan-runtime-fake.md §7` | `apps/agent-runtime/src/agent_runtime/providers/fake/{provider,directives,mcp_call}.py`, `tests/support/mcp_mock.py` | PY-05 | unit + int fake · acceptance AC-H22, AC-H12 (qc) | [ ] |
| **QA** | | | | | | | | |
| QW | qc: test-plan + acceptance/int theo §8 (đỏ đúng lý do) + mock Dify streaming của Hub (Q9) + script `done:h2a` | qc | cao | `spec §8`, `§7`, `H1 test-plan.md §7` | `tests/acceptance/H2a/**`, `tools/hub-dev/` | Gate | đỏ đúng lý do | [ ] |
| Q2 | Khoá test (`tests/.lock`) | qc | thường | `WORKFLOW` "Luật khoá test" | `tests/.lock` | QW | `bun run test:lock:verify` | [ ] |
| I1 | `done:h2a` toàn bộ + hồi quy `test:contract:chat` (HUB-H2a-AC-11) | qc | thường | `test-plan §7` | — | mọi task | `bun run done:h2a` | [ ] |
| I2 | Smoke thật Dify (`DIFY_LIVE=1`) + `claude-sub` gọi MCP (`HUB_LIVE=1`) | backend-lead | cao | `spec §7`, `§9 Q10` | `docs/specs/H2a-dify-command/smoke.md` | I1, W1 | biên bản smoke | [ ] |
| I3 | docs: CODEMAP, TRACE, README module, STATE, CR-impact cho Chat/Admin | docs-architect | thường | `WORKFLOW` bước 10 | `docs/**` | I1 | `bun run trace --check` | [ ] |
