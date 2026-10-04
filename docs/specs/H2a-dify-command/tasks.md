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
| PY-00 | Tách `runtimes/cli/job_run.py` (398/400 dòng) trước khi thêm MCP — không đổi hành vi | backend-lead | thường | `H1 spec-decisions "Nợ chuyển TECH-DEBT"` | `apps/agent-runtime/src/agent_runtime/runtimes/cli/` | — | `pytest` 310 ca H1 xanh | [ ] |
| PY-01 | Handler `workflow.async`: Dify streaming (httpx), tiến độ, retry 2 s/8 s, requeue khi orphaned | backend-lead | cao | `spec §2 R12, R13, R15`, `BA-W §2, §5.1` | `apps/agent-runtime/src/agent_runtime/runtimes/dify/` | C2, B6 | Python int HUB-H2a-AC-06, AC-W06 | [ ] |
| PY-02 | Nối MCP Hub vào Claude Agent SDK (`mcp` payload → server http, `allowed_tools`) | backend-lead | cao | `spec §2 R18`, `BA-W §5.2 FR-13` | `apps/agent-runtime/src/agent_runtime/{runtimes/cli,providers/claude}/` | PY-00, C2 | Python int | [ ] |
| PY-03 | `fake-cli` thêm `#fake:tool=<key>` gọi `/mcp` thật; xử lý `CONFIRMATION_REQUIRED` → `need_input` | backend-lead | thường | `spec §7`, `H1 plan-runtime-fake.md` | `apps/agent-runtime/src/agent_runtime/providers/fake/` | PY-02 | Python unit + AC-H22 | [ ] |
| PY-04 | Usage `billing=dify` cho `workflow.async` | backend-lead | thường | `spec §2 R15` | `apps/agent-runtime/src/agent_runtime/db/` | PY-01 | Python int | [ ] |
| **QA** | | | | | | | | |
| QW | qc: test-plan + acceptance/int theo §8 (đỏ đúng lý do) + mock Dify streaming của Hub (Q9) + script `done:h2a` | qc | cao | `spec §8`, `§7`, `H1 test-plan.md §7` | `tests/acceptance/H2a/**`, `tools/hub-dev/` | Gate | đỏ đúng lý do | [ ] |
| Q2 | Khoá test (`tests/.lock`) | qc | thường | `WORKFLOW` "Luật khoá test" | `tests/.lock` | QW | `bun run test:lock:verify` | [ ] |
| I1 | `done:h2a` toàn bộ + hồi quy `test:contract:chat` (HUB-H2a-AC-11) | qc | thường | `test-plan §7` | — | mọi task | `bun run done:h2a` | [ ] |
| I2 | Smoke thật Dify (`DIFY_LIVE=1`) + `claude-sub` gọi MCP (`HUB_LIVE=1`) | backend-lead | cao | `spec §7`, `§9 Q10` | `docs/specs/H2a-dify-command/smoke.md` | I1, W1 | biên bản smoke | [ ] |
| I3 | docs: CODEMAP, TRACE, README module, STATE, CR-impact cho Chat/Admin | docs-architect | thường | `WORKFLOW` bước 10 | `docs/**` | I1 | `bun run trace --check` | [ ] |
