# Test plan · H3b-agent-grants · nhật ký chạy (qc)

Kết quả "đỏ đúng lý do" (`WORKFLOW.md` "Luật khoá test") theo task. Phụ lục của [`test-plan.md`](test-plan.md); ca chi tiết: [`test-plan-cases.md`](test-plan-cases.md).

## QW · unit `tests/acceptance/H3b/rules/` (QW-R) + int `tests/acceptance/H3b/*.int.test.ts` (QW-A) + `tests/acceptance/H3b-cmd/` (QW-C)

Chạy 2026-10-06 trên code hiện tại: B0 `dcf855c` (stub `targetTenant`/`grantProblem`/`effectiveAgents`/`traceAccess`/`redactTraceDetail`/`stepMs` ném `not implemented`, regex PL15/PL16 thật), C1 `37c0c73` (contract `@ai/contracts/hub-admin`), D1 `19ec644` (migration 0009), chưa có route `/agent-grants*`, `/runs/:id/trace`, chưa có `AppDeps.hubAudit`.
DB Hub riêng của qc `ai_system_h3b_qw_hub_test` (`HUB_TEST_DATABASE_URL`/`AGENT_RT_TEST_DATABASE_URL` export trong shell, đè `.env.local`; DB tạo tay trước vì `prepareDb` không tạo DB khi biến này đặt), Redis DB 15; chạy **tuần tự** từng file.

Lệnh:
- QW-R: `bun test ./tests/acceptance/H3b/rules`
- QW-A: `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H3b/<file>.int.test.ts`
- QW-C (AC-13, ngoài `done:h3b`, I1 chạy tay): `bun --env-file=.env.local --config=bunfig.stack.toml test --timeout 30000 ./tests/acceptance/H3b-cmd` — **không** dùng `bunfig.int.toml`/`bunfig.toml`: cả hai có `tests/acceptance/H3b-cmd/**` trong `pathIgnorePatterns` (MK) nên bun bỏ cả khi chỉ định đường dẫn ("1 files were searched … Tests need .test"); `bunfig.stack.toml` chỉ bỏ `e2e`, `node_modules`, `__fixtures__`. Dòng I1 trong `tasks.md` còn ghi `bunfig.int.toml` (cũ).
- Kiểm tĩnh: `bunx tsc -p tsconfig.tests.json --noEmit` 0 lỗi ở `H3b/`, `H3b-cmd/` · `bunx biome check tests/acceptance/H3b tests/acceptance/H3b-cmd` sạch · `bun run check:size` OK · `bun run check:fn --files <18 file>` OK.

**Tổng: 138 ca — 112 đỏ đúng lý do, 26 xanh trước code; 0 ca đỏ do dựng dữ liệu** (không `PostgresError`/`TypeError`/`ZodError` trong `beforeAll`/fixture). Kế hoạch 136; thêm R42 (hằng regex, tách riêng) và A02b (đếm riêng).

### QW-R · 41 ca / 5 file: 33 đỏ, 8 xanh

| File | ID | Đỏ đúng lý do / tổng | Lý do đỏ | Xanh trước code |
|---|---|---|---|---|
| `target-tenant.test.ts` | R01–R07 | 7/7 | `not implemented` (B0) | — |
| `grant-problem.test.ts` | R10–R15 | 6/6 | `not implemented` | — |
| `effective-agents.test.ts` (+ `_snap.ts`) | R20–R29 | 10/10 | 9 `not implemented`; R29 `expect(...).not.toThrow()` (thân stub ném) | — |
| `trace-rules.test.ts` | R40–R49 | 10/11 | `not implemented` | R42 hằng `SENSITIVE_KEY_RE`/`SENSITIVE_VALUE_RE` (B0 thật) |
| `contracts-h3b.test.ts` | R60–R66 | 0/7 | — | cả 7 (C1 có): mã lỗi, `CHAT_API_ERRORS` 6 mã, schema strict/refine |

### QW-A · 92 ca / 9 file: 79 đỏ, 13 xanh

Lý do đỏ chung: route chưa có ⇒ hub-api trả **404 `NOT_FOUND`** (JSON đúng contract lỗi) thay cho 200/201/204/400/401/403/409/500 kỳ vọng — đỏ ở `expect` status/code, sau khi dựng dữ liệu xong.

| File | ID | Đỏ / tổng | Ghi chú đỏ | Xanh trước code |
|---|---|---|---|---|
| `role-tenant.int.test.ts` | A01–A14, A02b | 15/15 | A01/A02b: 404 thay 401 (`/agent-grants` chưa vào `PROTECTED_PREFIXES`; vế trace đã 401); A03 có đối chứng `GET` 200 trước khi so 404 | — |
| `grants-write.int.test.ts` | A20–A41 | 22/22 | A21–A23 đọc kết quả A20 (đỏ ở `expect` số hàng audit/NOTIFY/status); A38/A39 Hub thứ hai với `failingAudit` | — |
| `grants-concurrency.int.test.ts` | A45–A51 | 7/7 | A45/A46/A49/A50: `lockWaiters` = 0 (POST 404 không chờ khoá); A47 seed thật chạy **ok** (`seed: "ok"`), đỏ ở POST 404 | — |
| `grants-list.int.test.ts` | A55–A62 | 8/8 | 404; A58 xoá group, A62 chèn 201 agent + 501 user ⇒ dựng dữ liệu ok | — |
| `effective.int.test.ts` | A65–A72 | 8/8 | 404 (mỗi ca chờ cache ≤ 10 s ⇒ file ~80 s khi đỏ); A68 có đối chứng 200 | — |
| `propagation.int.test.ts` | A80–A86 | 6/7 | POST/DELETE 404; A85 đỏ dây chuyền (A84 không tạo được grant ⇒ `grantRow` undefined) | A80 (menu + prompt Orchestrator trước grant — code H1/H2b; xác nhận hạ tầng 2 instance + `ScriptRuntime`) |
| `trace.int.test.ts` (+ `_h3b-trace.ts`) | A90–A102, A97b | 13/14 | 404; A91/A92/A96 có đối chứng chủ run/`R_pad` 200 trước khi so 404; A98 404 thay 500 | A101 (`GET /runs/:id` strict chat — R20, code H1) |
| `cors.int.test.ts` | A110–A113 | 0/4 | — | cả 4 (P13: CORS danh sách trắng có sẵn, không đổi code) |
| `db-grants.int.test.ts` | A120–A126 | 0/7 | — | cả 7 (D1 có: quyền `hub_rw`, append-only, CHECK, cột, migrate lại + `usage_logs_run_idx`) |

### QW-C · `H3b-cmd/command-m5.int.test.ts` A130–A134: 5/5 xanh

Code H2a (không code mới). Thời gian menu cập nhật: A130 124 ms, A131 tắt 120 ms / bật 118 ms, A133 116 ms, A134 114 ms (≤ 5 s). Đỏ về sau ⇒ TECH-DEBT, không chặn (Q-K11).

### Ghi chú cho BUILD (B1–B6)
- Seam P12/N7: test truyền `deps.hubAudit = { insert(tx, row) }` qua `startHubX` (`_h3b.ts` `H3bExtra`); test chỉ đọc `row.action`. `failingAudit(actions)` ném ở **mọi** lần gọi (ghi `calls`): A38/A39 chỉ có một audit; **A98 khẳng định `calls = ["view_trace"]`** sau khi padmin gọi, và vẫn vậy sau khi chủ run gọi (nhánh chủ không gọi audit).
- "0 NOTIFY" dùng sentinel kênh riêng `qc_h3b_sentinel` trên cùng kết nối LISTEN (không gửi gì vào `hub_config_changed`).
- A21: `entity_name` = `"hoadon → ke-toan"` (U+2192); `after` đúng 5 khoá; A34 `before` = 5 khoá đó + `granted_by`, `granted_at` (giá trị `granted_by` không khoá).
- A93: `summary = {run_user_id, run_status}`, `entity_name = ''`, `hub_config_version` NULL.
- A97: `detail` gốc `{api_key, headers:{Authorization}, note:"sk-…"}` ⇒ `{api_key: MASK, headers:{Authorization: MASK}, note: MASK}`; `{tokenBudget}` ⇒ MASK. A102: step 2 có 2 dòng usage (một `cost_usd` NULL) ⇒ `input_tokens` 55, `cost_usd` null.
- A47 dùng bản sao `apps/hub-api/seed` với `agents.yaml` (orchestrator + hoadon, `profile: fake-1`) và `access.yaml` (entitlement hoadon/acme, grant hoadon → `group:kho`) riêng.
- Fixture H3b xoá mọi entitlement/grant H1 sau `insertHubConfig` rồi dựng bộ §2.1 (`hoadon` = agent H1, entitlement chuyển sang `acme`).

### File cần khoá (Q2)
`tests/acceptance/H3b/{_h3b,_h3b-trace}.ts`, `tests/acceptance/H3b/rules/{_snap.ts,target-tenant,grant-problem,effective-agents,trace-rules,contracts-h3b}.test.ts`, `tests/acceptance/H3b/{role-tenant,grants-write,grants-concurrency,grants-list,effective,propagation,trace,cors,db-grants}.int.test.ts`, `tests/acceptance/H3b-cmd/command-m5.int.test.ts` (18 file). Chưa khoá — Q2 chạy `test:lock:write`.

## Q2 — khoá (điều phối, 2026-10-06)
`test:lock:verify` trước khi ghi: đúng 18 UNLOCKED (`tests/acceptance/H3b/**` 17 file + `tests/acceptance/H3b-cmd/command-m5.int.test.ts`), 0 CHANGED → `test:lock:write` → verify OK. `tasks.md` I1: lệnh AC-13 đổi sang `--config=bunfig.stack.toml` (bunfig.int.toml bỏ qua `H3b-cmd/**`).

## Tranh chấp TC1/TC2 (qc phân xử, 2026-10-06)
- **TC1 — test sai.** `grants-concurrency` A50/A51 phụ thuộc thứ tự: A47 (cùng file, không dọn) đã cấp `hoadon → user hoa`, `tatt → user tam`; POST lại = trùng ⇒ 200 đúng R06 (HUB-H3b-AC-04), nên A50 không có backend chờ `audit_log`, A51 nhận `[201, 200]`. Code đúng. Sửa: thêm `dropUserGrant` (xoá hàng bằng SQL, không bump version) đầu A50 (`hoadon→hoa`) và A51 (`cliX→tam`, `tatt→tam`); kỳ vọng giữ nguyên (không yếu đi).
- **TC2 — test sai.** `role-tenant` A06 vế `?tenant_id=abc` kỳ vọng `details: undefined`, nhưng contract `VALIDATION_ERROR` luôn có `details.issues` (ValidationErrorDetailsSchema). Sửa: so `[tên endpoint, 400, "VALIDATION_ERROR"]` cho 4 endpoint và thêm kiểm `details.issues.length > 0` (chặt hơn trước). A13 chỉ so status/code nên không đổi.
- Kết quả: `grants-concurrency` 7/7 xanh. `role-tenant` 11 pass / 4 fail: A04, A05, A13, A06 đỏ ở vế **effective** (endpoint trả 404 NOT_FOUND vì B4 chưa xong — chờ B4), vế `abc` của A06 đã qua assertion tới được (không đỏ vì details).
- **File cần khoá lại:** `tests/acceptance/H3b/grants-concurrency.int.test.ts`, `tests/acceptance/H3b/role-tenant.int.test.ts`.
