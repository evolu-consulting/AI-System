# Test plan · H4a-studio-shell-agents (qc)

Chế độ **WRITE** (bước 3 vòng mốc) · 2026-10-06. Test đã viết + chạy "đỏ đúng lý do" (§7); **chưa khoá** `tests/.lock` (khoá sau Gate, chế độ LOCK).
"Đúng" = spec §2 (H4a-R01…R14), §8 (H4a-AC-01…11), contract + endpoint × lỗi + luật thuần `plan.md` §2–§5 (commit 06dc5e8), route/nhãn e2e `plan-frontend.md` §2, §3, §6 + câu chữ `plan-frontend-copy.md` (commit 97b9420). Câu hỏi mở dùng **mặc định đề xuất** (Q1–Q10, QB1–QB7, QF1–QF3) — ca phụ thuộc mặc định nào ghi ở §4 để sửa nhanh nếu Gate đổi. Hộp đen: không đọc code implementation (chỉ đọc schema DB + fixture test cũ để dựng dữ liệu).

## 1. Quy ước
Như H3b §1 (tên test có mã, chờ theo điều kiện không `sleep`, cấm `skip/only/todo`, id cố định, ca tự dọn), thêm:

| Mục | Quy ước H4a |
|---|---|
| Tên test | `"<mã BA> · <ID> · mô tả [H4a-Rxx · H4a-AC-yy · Qx]"` |
| Mã đầu tên | role/me/tĩnh/UI khung → `HUB-FR-72`; CRUD agent, chặn xoá → `HUB-FR-60`; agentic-cli/Bash → `HUB-FR-61`; Orchestrator → `HUB-FR-62`; workflow → `HUB-FR-64`; version/audit/NOTIFY → `HUB-FR-69`; `agent_types` → `HUB-FR-90`; provider không secret → `HUB-FR-68` (bối cảnh R13) |
| Loại | **R** unit hàm thuần + contract (`bun test`) · **A** int hub-api thật (DB + Redis test, `ScriptRuntime` H1 đóng vai Runtime) · **E** e2e Playwright studio-web, API giả lập bằng `page.route` (spec §7 "test FE: mock http") |
| Vị trí | R `tests/acceptance/H4a/rules/*.test.ts` · A `tests/acceptance/H4a/*.int.test.ts` · E `e2e/studio/*.studio.ts` + config riêng `e2e/studio/playwright.config.ts` (project **`studio`**, mẫu `e2e/chat`) |
| Role DB | Request qua `hub_api` của app thật; dựng/kiểm dữ liệu bằng owner (`ownerSql`) |
| "0 ghi" | `configState()` (agents + agent_workflows + orchestrator_settings + `hub_config_version` + max `audit.seq`) trước ≡ sau; NOTIFY vắng: sentinel kênh riêng (`listenHub` H3b) |
| Audit | append-only ⇒ đếm `seq > mốc` (`auditSince`) |

## 2. Hạ tầng, fixture (`tests/acceptance/H4a/_h4a.ts`, id dải `a4a0…`)
`setupH4a()` = `setupH2b({catalogBaseUrl})` (H1 tenant/user + cấu hình Hub H1 + catalog H2a + agent H2a/H2b; run `runLive` đã kết thúc) **+** bộ H4a:

| Dữ liệu | Dùng cho |
|---|---|
| User H1: `padmin` (platform_admin, tenant `platform`), `tadmin` (tenant_admin acme), `lan` (acme), `an` (beta), `gam` (gamma) | role (A01–A03), run theo tenant (A63–A65) |
| Tenant: acme, beta, gamma active; **zeta active=false** | `TENANT_INACTIVE` (A57) |
| Catalog `admin.workflows`: `tom`, `dich`, `so` (input number) = workflow; `hoi` = chat; `tro-ly` = agent; **`tat` tắt** | A12–A13, A28–A32 |
| Agent H1/H2: `orchestrator` (mặc định), `assistant` (ent 2 + grant), `hoadon` (2 workflow, có `tat`), `trello`, `dify-tom`, `dify-tro-ly`, `writer`, `llmbot`, `orch-acme`, `orch-alt` | danh sách, AGENT_HAS_ACCESS |
| Agent H4a: `co-lich-su` (run_steps ở run acme — R-K2), `co-quyen` (ent acme, 0 grant), `llm-bot` (llm), `dang-tat` (tắt), `orch-beta4` (Orchestrator tenant beta), `tu-do` (tự do), `co-bash` (đã có Bash) | A42–A48, A50–A62 |
| `agent_types`: `py-report` (python), `py-old` (available=false), `cli-tool` (agentic-cli) | A15, A27 |
| `studioDist` = `tests/acceptance/H4a/__fixtures__/studio-dist/` (`index.html` có `QC-H4A-STUDIO-INDEX`, `static/js/app.js`) | A67–A74 |
| Hub: `startHubH2b(k, {instanceId, hubAudit?, studioDist?})` — seam `AppDeps.hubAudit` (P7) + `AppDeps.studioDist` (plan §9) | A41, A67–A74 |

E2E: `e2e/studio/_support.ts` — kho trong bộ nhớ (4 agent: `orchestrator` mặc định, `hoadon` ent 2, `helper` llm ent 0, `dify-tom`), `hub config v7`, `/auth/login|refresh|logout` giả lập (mật khẩu `dev-password-1`), ghi lại mọi call `/studio/api/*`. webServer: `build` + `preview` `@ai/studio-web` cổng 3200 (biến `STUDIO_E2E_WEB_PORT`).

## 3. Ma trận AC → test
| AC | Given / When / Then (chi tiết qc) | Loại · file | Ca |
|---|---|---|---|
| H4a-AC-01 | Không token ⇒ 401 `AUTH_EXPIRED` ở **18** endpoint; `tadmin`/`lan`/`an` ⇒ 403 `FORBIDDEN` ở 18 endpoint + 0 ghi; 403 trước parse (body/query sai vẫn 403); UI role khác ⇒ trang "Bạn không có quyền vào Agent Studio", chỉ gọi `GET /me` | A `role-read` · E `auth` · R `orchestrator-overlap` | A01, A02×3, A03 · E03×2 · R33 |
| H4a-AC-02 | `padmin` đăng nhập ⇒ danh sách agent seed (total = DB), runtime/profile đúng, badge Orchestrator (`orchestrator_of`), "Chưa cấp" khi 0 tenant, không cột 24 giờ; khung + menu + badge `hub config vN`; `/me` | A `role-read` · E `auth`, `agents` | A04–A10 · E01, E04, E05, E06, E07, E12, E14, E15, E16 |
| H4a-AC-03 | POST llm ⇒ 201, có trong list, audit +1 (create, before null, tenant null, actor padmin, cùng version), `hub_config_version`+1, NOTIFY ≤ 1 s; thiếu `name.en` ⇒ 400 `VALIDATION_ERROR` có `issues[].path = name.en` + 0 ghi; biên QB2 | A `agents-write` · R `contracts-h4a` | A20–A26 · R43–R45 |
| H4a-AC-04 | Hai bản cùng `version 1`: bản 1 ⇒ 200 v2; bản 2 ⇒ 409 `VERSION_CONFLICT {current = bản 1, updated_at}`, DB giữ bản 1; UI tab 2 ⇒ `alertdialog "Có người vừa lưu bản mới hơn"` + "Tải bản mới" nạp bản tab 1 | A `agents-write`, `orchestrator` · E `agents` | A37, A40, A53, A60, A62 · E10 |
| H4a-AC-05 | workflow tắt ⇒ 400 `INVALID_REFERENCE{workflow_ids, disabled}`; không tồn tại ⇒ `not_found` + `ids`; dify-workflow 2 workflow ⇒ 400; app sai ⇒ `app_type`; không input ⇒ `no_input`; hợp lệ ⇒ `agent_workflows` có dòng; picker/`GET /workflows` không có `tat` | A `agents-write`, `role-read` · R `agents-rules` · E `agents` | A12, A13, A24, A28–A32 · R01–R05 · E09 |
| H4a-AC-06 | Bash không ack / ack false ⇒ 422 `BASH_ACK_REQUIRED` + 0 ghi; ack ⇒ 201 + audit `summary.bash_ack`; sửa giữ Bash không cần ack, thêm Bash cần ack; UI: chưa tick xác nhận không gửi, tick ⇒ POST có `bash_ack: true` | A `agents-write` · R `agents-rules` · E `agents` | A33–A35 · R06–R08 · E08 |
| H4a-AC-07 | Tắt (PATCH/PUT) hoặc xoá Orchestrator mặc định/tenant ⇒ 409 `AGENT_IN_USE_AS_ORCHESTRATOR{scopes}`; xoá agent có run_steps ở tenant khác actor ⇒ 409 `AGENT_HAS_HISTORY` (R-K2); còn entitlement/grant ⇒ `AGENT_HAS_ACCESS{entitlements, grants}`; version sai đi trước | A `agents-write`, `orchestrator` · R `agents-rules` | A42–A48, A61 · R09–R13 |
| H4a-AC-08 | POST tenant acme ⇒ 201; lần 2 ⇒ 409 `ORCHESTRATOR_EXISTS`; xoá mặc định ⇒ 409 `ORCHESTRATOR_DEFAULT_PROTECTED`; run mới của `lan` (acme) ≤ 5 s dùng agent bản tenant + `runs.orchestrator_tenant_id = acme`; `gam` (gamma) dùng mặc định, `an` (beta) dùng bản beta | A `orchestrator`, `propagation` · R `orchestrator-overlap` · E `agents-menu`, `orchestrator` | A54–A60, A62, A63, A64 · R30–R32 · E13, E13b, E17 |
| H4a-AC-09 | Run `gam` đang chạy (job 1 có prompt cũ) → PUT `system_prompt` Orchestrator mặc định qua Studio → run mới ≤ 5 s có prompt mới; job Orchestrator kế của run cũ vẫn prompt cũ (BR-06); đổi profile phản ánh ở GET; `/me.hub_config_version` theo kịp | A `propagation` | A65, A66 |
| H4a-AC-10 | `/providers`: `has_secret` bool; không `secret_id`/`ciphertext`/`iv`/`last_error`/`last4` ở key nào, không id secret trong thân | A `role-read` | A17 |
| H4a-AC-11 | `/studio` ⇒ 308 `/studio/`; `/studio/` + reload sâu (`/studio/agents/x`, `?tenant=new`, `/login`) ⇒ `index.html` no-cache; asset ⇒ immutable; file có đuôi thiếu ⇒ 404 JSON; header nosniff/DENY/no-referrer; chặn `..`; `/studio/api/*` không rơi vào fallback (R-K5); không dist ⇒ 404 JSON | A `static` | A67–A74 |

### 3.1 Luật → ca (mỗi luật ≥ 1 ca)
| Luật | Ca |
|---|---|
| R01 role | A01–A03, R33, E03 |
| R02 me | A04, A66, E01 |
| R03 trường agent (theo QB2) | A22, A24, A25, R44–R46 |
| R04 workflow | A12, A13, A28–A32, R01–R05, R14, E09 |
| R05 agentic-cli/Bash, codex/gemini | A33–A36, R06–R08, R15–R17, R47, E08 |
| R06 chặn tắt/xoá | A42–A48, A61, R09–R13, E07 |
| R07 Orchestrator | A19, A50–A62, R25–R32, R51 |
| R08 cảnh báo `agentic_cli_slow`, mô tả trùng ý | A19, A53, R29, R34–R38 |
| R09 version + audit + bump + NOTIFY một transaction | A20, A37, A38, A40, A41, A48, A53, A55, A62 |
| R10 lan run mới ≤ 5 s, run cũ giữ snapshot | A63, A65 |
| R11 danh sách (cột, lọc, badge) | A05–A09, E06, E07 |
| R12 nhân bản (UI, chưa gọi API) | **chưa có ca** — xem §8 G12 |
| R13 không lộ secret | A17 |
| R14 đăng nhập qua admin-api, URL đích | E01, E02 |
| QB5 key/runtime bất biến | A39, R49, E11 |

### 3.2 Endpoint × ca (mọi endpoint có ca role + ca thành công/lỗi)
| Endpoint | Role | OK | Lỗi |
|---|---|---|---|
| `GET /me` | A01–A03 | A04 | — |
| `GET /agents` | A01–A03 | A05–A08, A21 | A09 |
| `POST /agents` | A01–A03 | A20, A25, A27, A30–A32, A34, A36 | A22–A24, A26–A29, A33, A41 |
| `GET /agents/:id` | A01–A03 | A10, A11 | A10 (404) |
| `PUT /agents/:id` | A01–A03 | A32, A35, A37, A38, A65 | A35, A37, A39, A43 |
| `PATCH /agents/:id/enabled` | A01–A03 | A40 | A40, A42, A61 |
| `DELETE /agents/:id` | A01–A03 | A48 | A44–A47 |
| `GET /orchestrator` | A01–A03 | A19, A59 | — |
| `PUT /orchestrator/default` | A01–A03 | A53 | A50–A53 |
| `DELETE /orchestrator/default` | A01–A03 | — | A54 |
| `POST /orchestrator/tenants` | A01–A03 | A55, A63 | A56–A58 |
| `PUT /orchestrator/tenants/:id` | A01–A03 | A60 | A60 |
| `DELETE /orchestrator/tenants/:id` | A01–A03 | A62 | A62 |
| `GET` 5 catalog | A01–A03 | A12–A17 | A18 |
| `/studio/*` tĩnh | — | A67–A69, A71 | A70, A72–A74 |

## 4. Ca phụ thuộc mặc định — **đã chốt 2026-10-06** (người dùng chấp nhận Q1–Q9, QB1 chỉ `agentic-cli`, QB2–QB7, QF1–QF3, G1–G13; Q10 chưa nằm trong quyết định — còn chờ). Bảng giữ để biết ca nào sửa nếu sau này mở lại
| Mặc định | Nội dung dùng trong test | Ca |
|---|---|---|
| **QB1** chỉ `agentic-cli` làm Orchestrator | `llm` ⇒ 409 `AGENT_NOT_ORCHESTRATABLE{runtime_unsupported}` | A50, A58, R27, R28 |
| **QB2** theo CHECK DB | key không `_` (2–48), mô tả 20–400, timeout 10–3600, `history_n` 1–50 | A24 (4 ca), A25, A52, R44, R45, R51 |
| **QB3** dify-* ghi cả `workflow_key` + `agent_workflows`; dify-agent nhận chat\|agent | A12 (`usable_for`), A29–A31, R03, R05, R14 |
| **QB4** `profile_id` NULL cho dify-* | A30, R46 |
| **QB5** key/runtime bất biến | A39, R49, E11 |
| **QB6** audit agent + Orchestrator mặc định `tenant_id` NULL; Orchestrator tenant ghi tenant đích | A20, A38, A48, A49, A53, A55, A62 |
| **QB7** Edit/Bash lưu được + `tools_not_supported`; python không kiểm JSON Schema | A27, A34, R15–R18 |
| Q2 đăng nhập `admin-api POST /auth/login` (+ refresh cookie) | E01–E03 (mock `/auth/*`) |
| Q3 token trong bộ nhớ, refresh 1 lần khi tải | E01 (`/auth/refresh` 401 ⇒ `/login?next=`), E04–E11 (refresh 200) |
| Q5 Hono serve `studioDist` + SPA fallback | A67–A74 |
| Q6 xoá cứng có điều kiện | A44–A48 |
| Q7 lưu thẳng (không `ROUTING_REGRESSION`) | A38, A53, A65 |
| Q8 codex/gemini lưu được + cảnh báo | A36, R16 |
| QF1 validate theo contract (không theo số R03) | A24, E08 (câu "Xác nhận bạn hiểu rủi ro khi bật Bash") |
| QF2 bước TOTP ở đăng nhập Studio | E14 |
| QF3 "Đặt làm Orchestrator" ở menu | E13, E13b (vế API = A53) |
| R12 Nhân bản (`?from=`) | E12 |

## 5. Rủi ro chập chờn
| Rủi ro | Giảm |
|---|---|
| NOTIFY ≤ 1 s (A20) đo bằng đồng hồ test | đo từ trước request tới lúc LISTEN nhận; nới không cần (cùng máy) — nếu chập chờn ghi `test-plan-log.md`, không sửa ngưỡng spec |
| Lan run ≤ 5 s (A63, A65) | chờ tối đa 10 s, khẳng định ≤ 5 s, in ms (mẫu H3b A80) |
| Run còn chạy giữa ca | `afterEach settleRuns` (H2b) |
| e2e build studio-web lâu | `timeout 180 s` webServer; `workers: 1` |

## 6. Lệnh xong mốc — `bun run done:h4a` (thống nhất, readiness M2)
Một nguồn duy nhất cho spec §8 / tasks / test-plan: lệnh e2e là **`bun run e2e:studio`** (không dùng `bunx playwright test studio`). Việc thêm file/script do task **I1** (cột File: `tools/scripts/src/done-h4a.ts`, `package.json` gốc 2 script) và **F1** (cấu hình depcruise studio-web) — qc không sửa ngoài `tests/**`, `e2e/**`, test-plan. Mẫu `done:h3b`:
```
"done:h4a": "bun --env-file=.env.local tools/scripts/src/done-h4a.ts"
"e2e:studio": "bunx playwright test -c e2e/studio/playwright.config.ts"
```
`done-h4a.ts` chạy tuần tự (dừng ở bước đỏ đầu tiên), `done:h4a` xanh khi tất cả xanh:
| # | Bước | Lệnh |
|---|---|---|
| 1 | các bước `done-h3b.ts` (typecheck, `bun test`, `test:int`, e2e cũ) | như `done-h3b.ts` |
| 2 | R H4a | `bun test tests/acceptance/H4a/rules` |
| 3 | A H4a (gồm hồi quy int bắt buộc plan §7) | `bun run test:int` (gồm `tests/acceptance/H4a/*.int.test.ts`) |
| 4 | E studio (19 ca) | `bun run e2e:studio` |
| 5 | vết FR | `bun run trace --check` |
| 6 | bundle | `check:bundle` studio-web |
| 7 | khoá test | `bun run test:lock:verify` |
Chạy tay trong lúc chờ I1:
```
bun test tests/acceptance/H4a/rules
bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 tests/acceptance/H4a/
bunx playwright test -c e2e/studio/playwright.config.ts
```
Int bắt buộc chạy lại khi BUILD (plan §7): H1 `concurrency`, A37 `lock-order`, H1/H2a/H2b `seed.int`, H3b `agent-grants` int.

## 7. Đỏ đúng lý do · kết quả chạy 2026-10-06 (code hiện tại, trước B1)
| Nhóm | File | Ca | Kết quả | Lý do đỏ |
|---|---|---|---|---|
| R | `rules/agents-rules.test.ts` | 18 (R01–R18) | đỏ (file) | `Cannot find module …/modules/studio/agents/agents.rules` — module chưa có |
| R | `rules/orchestrator-overlap.test.ts` | 14 (R25–R38) | đỏ (file) | `Cannot find module '@ai/contracts/studio'` (+ `orchestrator-settings.rules`, `isStudioRole` chưa có) |
| R | `rules/contracts-h4a.test.ts` | 12 (R41–R52) | đỏ (file) | `Cannot find module '@ai/contracts/studio'` |
| A | `role-read.int.test.ts` | 21 | 21 đỏ | `expect`: route chưa có ⇒ 404 `NOT_FOUND` thay 401/403/200/400 |
| A | `agents-write.int.test.ts` | 45 | 45 đỏ | `expect`: 404 thay 201/400/409/422/500/204; A49 `toBeGreaterThan` (0 audit agent) |
| A | `orchestrator.int.test.ts` | 13 | 13 đỏ | `expect`: 404 thay 200/201/400/409 |
| A | `propagation.int.test.ts` | 4 | 3 đỏ · **1 xanh** | đỏ ở `expect(status)` 404; **A64 xanh trước code** (định tuyến tenant H2b đã có — chấp nhận, khoá hồi quy) |
| A | `static.int.test.ts` | 8 | 6 đỏ · **2 xanh** | đỏ: 404 thay 308/200/401, thiếu header; **A70, A72 xanh trước code** (404 JSON sẵn có khi `/studio` chưa mount — chấp nhận) |
| E | `e2e/studio/{auth,agents,agents-menu,orchestrator}.studio.ts` | 19 (E01–E17 + E03×2 + E13b) | đỏ (cả bộ) | webServer `bun run --filter @ai/studio-web build` ⇒ `No packages matched the filter` — app chưa có; `--list` liệt kê đủ 19 ca (cú pháp hợp lệ); biome sạch; tsc sạch (trừ `process` ở config) |

Tổng **154 ca**: R 44 · A 91 · E 19 (readiness 1/M3: +7 e2e). Int: 88/91 đỏ đúng lý do (`expect`), 3 xanh trước code chấp nhận; **0 ca đỏ do dựng dữ liệu** (`beforeAll` cả 5 file chạy qua: không `PostgresError`/`TypeError` fixture — đã sửa 4 ca từng đỏ `TypeError` do đọc `json.agent.id` trước khi khẳng định 201). R/E đỏ ở mức module/app chưa có. `tsc -p tsconfig.tests.json`: chỉ lỗi `TS2307/TS2305` module chưa có (5 dòng, 3 file rules) — hết khi B1 tạo contract + file rules (stub `not implemented` như H3b sẽ chuyển R sang đỏ ở `expect`). `biome check` sạch.

## 8. Chỗ hở spec (mặc định qc đã dùng) · Cần bổ sung
| # | Hở | Mặc định trong test | Agent |
|---|---|---|---|
| G1 | spec §3 `GET /agents` `limit … =50` vs plan §2.3 (E1) mặc định **200** | theo plan (200); A05 kỳ vọng trả hết mọi agent fixture (< 50) không truyền `limit` | backend-lead sửa spec §3 |
| G2 | `plan-frontend.md` §4 câu validate dùng số R03 (key `_`, 2–40, mô tả 1–1000, timeout 1–3600, `history_n` 0–50) — lệch contract QB2 | e2e không kiểm các câu này; QF1 "theo contract" | frontend-lead sửa §4 + copy theo QB2 |
| G3 | `agentWarnings(a)` chưa ghi kiểu `a` | `{runtime, runtime_options}` | backend-lead ghi chữ ký ở plan §4.1 |
| G4 | `similarAgents` chưa ghi kiểu trả về | phần tử có `agent_id` (hoặc `id`) + `score`, sắp giảm | backend-lead |
| G5 | `WorkflowProblem` với `disabled/app_type/no_input` có `ids` không | chỉ kiểm `reason`; `ids` chỉ kiểm cho `not_found` | backend-lead |
| G6 | mã lỗi 500 khi audit lỗi (A41) | chỉ kiểm status 500 (+ rollback) | — |
| G7 | `dify-workflow` có cảnh báo `runtime_not_ready` không | không (dify-* nằm trong `RUNNABLE_RUNTIMES`) — R18 | backend-lead xác nhận |
| G8 | spec §8 nói qc viết `spec-ac.md` | AC chi tiết đặt ở §3 test-plan này (không file riêng) | — |
| G9 | AC-09 "profile mới" không quan sát được qua run (một provider giả) | A66 kiểm qua `GET /agents/:id` + `me` | — |
| G10 | Nút "Về Chat" ẩn khi vắng `PUBLIC_CHAT_WEB_URL` | E03 không khẳng định link | — |
| G11 | `GET /studio` 308 hay 301/302 | 308 (plan §5.4) | — |
| G12 | ~~Chưa có ca e2e~~ **đã bổ sung** (readiness 1, M3): Nhân bản E12, Đặt làm Orchestrator E13/E13b, TOTP E14, Hoàn tác tắt E15, mất mạng E16, Sheet Orchestrator tenant E17 | nhãn/role theo `plan-frontend.md` §6; câu chữ theo `plan-frontend-copy.md`; phần chưa quy định (role của ConfirmDialog = `alertdialog`, nút Huỷ, nhãn lỗi mã TOTP sai) dùng mặc định cùng kiểu Xoá agent | qc (xong) · frontend-lead giữ role/nhãn |
| G13 | Nhãn e2e `table "Danh sách agent"` có `columnheader` không (E06 kiểm "không cột 24") | dùng `columnheader` theo vai trò bảng chuẩn | frontend-lead giữ `<th>` |

## 9. Khoá
Chưa ghi `tests/.lock`. Chế độ LOCK sau Gate: `bun run test:lock:write` cho `tests/acceptance/H4a/**` + `e2e/studio/**`, rồi `bun run test:lock:verify`.
