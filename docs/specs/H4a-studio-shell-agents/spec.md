---
id: H4a-studio-shell-agents
title: Studio khung + đăng nhập + Agents + Orchestrator (mặc định và theo tenant)
milestone: H4a
status: approved                        # draft → ready → approved → in-progress → done
requirements:
  [HUB-FR-72, HUB-FR-60, HUB-FR-61, HUB-FR-62, HUB-FR-64 (gắn workflow, không có chạy thử), HUB-FR-69 (ghi audit + version + NOTIFY cho agent/Orchestrator; xem/khôi phục → H4d), HUB-FR-90 (đọc `agent_types`), HUB-BR-08, HUB-BR-09 (vế gắn workflow), HUB-BR-06 (bối cảnh)]
design:
  - docs/design/agent-hub/ba-agent-hub.md (§6.7 FR-60…64, 69, 72; §6.3 FR-62, 90; §7 BR-08, 09; §8 `agents`, `agent_workflows`, `agent_types`, `orchestrator_settings`, `audit_log`/`config_meta`; §9.1 dòng `/studio`; §9.3 mã lỗi)
  - docs/design/agent-hub/ui-agent-studio.md (§1 S1–S5; §2 cây menu; §3 khung; §5.1 danh sách; §5.2 editor; §6 Orchestrator (bỏ phần Kiểm thử/Dry-run); §13 validation)
  - canvas: docs/design/agent-hub/canvas/Main.dc.html, AgentEditor.dc.html, Orchestrator.dc.html (bỏ tab Kiểm thử)
  - docs/design/admin/ui-admin.md (§4–6 khung, DataTable, ConfirmDialog; §7.1 đăng nhập — dùng làm mẫu, không import code Admin)
  - docs/specs/H2b-routing/spec.md (Orchestrator theo tenant ở runtime) · docs/specs/H3b-agent-grants/spec.md (mẫu audit + `hub_config_version` + NOTIFY, CORS)
  - ADR-0001 (stack FE) · CR-020, CR-025, CR-032
owner: backend-lead + frontend-lead
---

# H4a · Studio: khung, đăng nhập, Agents, Orchestrator

> Mốc con đầu của H4 (lý do chia: [ROADMAP](../../ROADMAP.md) mục H4a–H4d). Mục tiêu người dùng: **mở `/studio`, đăng nhập `platform_admin`, xem và sửa agent + Orchestrator bằng UI thật**, dữ liệu trong `hub.*` (agent/Orchestrator seed H1–H2b).

## 1. Phạm vi
**Làm:**
- **App mới `apps/studio-web`** (Rsbuild + React + Tailwind + shadcn, TanStack Router/Query, react-hook-form + zod, i18n VI/EN — ADR-0001). Khung (topbar "✦ Agent Studio", menu theo [ui §2](../../design/agent-hub/ui-agent-studio.md), badge `hub config vN`), trang đăng nhập, trang "không có quyền", trạng thái tải/rỗng/lỗi. Mục menu chưa làm hiện mờ "Sắp có" (không route chết).
- **`/studio/api/*` trong `apps/hub-api`** (role `platform_admin`): `agents` (CRUD + bật/tắt), `orchestrator` (bản mặc định + theo tenant), và đọc: `agent-types`, `model-profiles`, `providers` (kèm `provider_state`), `workflows` (catalog Admin, chỉ workflow bật), `tenants` (chọn tenant cho Orchestrator), `me`.
- **Ghi cấu hình an toàn:** mỗi lần lưu: kiểm `version` (409 `VERSION_CONFLICT`), ghi `hub.audit_log` (trước/sau), tăng `hub_config_version`, NOTIFY `hub_config_changed` — cùng giao dịch (mẫu H3b).
- Editor agent theo runtime (`llm`, `agentic-cli`, `dify-workflow`, `dify-agent`, `python` — form dựng từ `agent_types.config_schema`), picker workflow từ catalog, `agentic-cli`: CLI/tool/MCP/cwd + tick xác nhận Bash (FR-61).
- Hub phục vụ bản build ở `/studio` (cùng origin, FR-72); dev: `rsbuild dev` + CORS.

**Không làm (mốc sau):**

| Việc | Mốc | Vì sao |
|---|---|---|
| Dry-run, bộ câu kiểm thử định tuyến + chặn lưu `ROUTING_REGRESSION` (BR-13), "Xem như model thấy", chạy thử workflow/agent, Playground | H4c | cần chạy Orchestrator trên bản nháp + tốn model; H4a lưu thẳng (bộ câu chưa có) |
| Providers/Profiles CRUD, Secrets, Quyền agent (entitlement) | H4b | H4a chỉ **đọc** profile/provider cho ô chọn |
| Trang Nhật ký, khôi phục bản trước, Import/Export, Đơn giá (`price_book`) | H4d | Đơn giá phụ thuộc H3c (tạm dừng) |
| Tổng quan, Runs/Chi phí/Jobs (ui-operations) | sau H4 | cần dữ liệu H3c / ngoài FR-63–73 |
| Sửa `apps/admin-web`, `apps/admin-api` (nút "⇄ Studio", CORS Admin) | — | ngoài phiên Hub → CR-044 |
| Tạo/sửa workflow, mô tả tool | không bao giờ | S4: workflow thuộc Admin |

## 2. Nghiệp vụ
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H4a-R01 | Mọi `/studio/api/*` cần JWT hợp lệ (cùng cách verify như H1) **và** `role=platform_admin`; thiếu token 401; role khác 403 `FORBIDDEN`. UI: không phải `platform_admin` → trang "Bạn không có quyền vào Agent Studio" + nút về Chat, không gọi API cấu hình | FR-72, ui §3 |
| H4a-R02 | `GET /studio/api/me` trả `MeSchema` ([plan §2.2](plan.md#22-chung-studiocommonts): `user_id, tenant_id, tenant_key, username, display_name, role, hub_config_version`); UI dùng để kiểm role sau đăng nhập và hiện badge | ui §3 |
| H4a-R03 | Agent: `key` duy nhất, bất biến sau tạo (`^[a-z][a-z0-9-]{1,47}$`: 2–48 ký tự, không `_`); `name{vi,en}` bắt buộc cả hai; `description` bắt buộc (Orchestrator thấy, 20–400 ký tự, **chặn lưu** nếu ngoài khoảng); `profile_id` bắt buộc với `llm`/`agentic-cli`, bị bỏ với `dify-*`; `timeout_s` 10–3600; `token_budget` ≥ 1 hoặc null | FR-60, ui §13 |
| H4a-R04 | `dify-workflow`: đúng một workflow (loại `workflow`); `dify-agent`: đúng một workflow loại agent; `llm`/`agentic-cli`: 0..n workflow. Chỉ workflow đang bật và tồn tại trong `admin.workflows`; ghi `hub.agent_workflows`. Studio không lưu tên/mô tả workflow | FR-64, BR-09 |
| H4a-R05 | `agentic-cli`: `runtime_options{cli: claude\|codex\|gemini, allowed_tools[], mcp: bool, cwd_mode}`; chọn `Bash` ⇒ bắt buộc `bash_ack=true` hoặc 422 `BASH_ACK_REQUIRED`. `codex`/`gemini` lưu được, UI cảnh báo "chưa chạy được tới khi H2d" | FR-61, CR-041 |
| H4a-R06 | Tắt/xoá agent đang là Orchestrator (mặc định hoặc của tenant) → 409 `AGENT_IN_USE_AS_ORCHESTRATOR`. Xoá agent đã có `runs`/`run_steps` tham chiếu → 409 `AGENT_HAS_HISTORY` (gợi ý Tắt). Xoá agent còn entitlement/grant hiệu lực → 409 `AGENT_HAS_ACCESS` | ui §5.2, BR-17 |
| H4a-R07 | Orchestrator mặc định (`tenant_id` null): đúng một, **không xoá được**. Bản tenant: ≤ 1 mỗi tenant (409 `ORCHESTRATOR_EXISTS`), tenant phải tồn tại, không bị khoá (đọc `admin.tenants`). Trường: `agent_id` (agent bật; **chỉ runtime `agentic-cli`** — QB1, hằng `ORCHESTRATOR_RUNTIMES` trong `@ai/contracts/studio`), `max_steps` 1–20, `token_budget` ≥ 1000, `history_n` 1–50, `on_no_match` `answer\|ask` | FR-62, BR-08 |
| H4a-R08 | Agent `agentic-cli` làm Orchestrator: lưu được, UI cảnh báo "Chậm…" (ui §6). Mô tả trùng ý giữa hai agent (so từ khoá, Jaccard ≥ 0,6 trên từ ≥ 3 ký tự): chỉ **badge cảnh báo**, không chặn | ui §6, CR-025 |
| H4a-R09 | Mọi ghi gửi `version` hiện có; lệch → 409 `VERSION_CONFLICT` `{current}` (modal xung đột theo mẫu Admin, CR-008/016). Thành công: `version`+1, một dòng `audit_log` (actor, entity, action, before, after, tenant), `hub_config_version`+1, NOTIFY `hub_config_changed` — một giao dịch; ghi audit lỗi ⇒ rollback | FR-69 |
| H4a-R10 | Sau NOTIFY Hub nạp lại cấu hình (FR-03, đã có): run **mới** dùng bản mới ≤ 5 s; run đang chạy giữ snapshot (BR-06) | FR-03, BR-06 |
| H4a-R11 | Danh sách agent (ui §5.1): tên, key, runtime, profile hiện tại, số workflow, số tenant có entitlement (0 ⇒ badge "Chưa cấp"), badge "Orchestrator", bật/tắt; tìm theo key/tên; lọc runtime, bật/tắt. **Bỏ cột "24 giờ"** (cần Vận hành) | ui §5.1 |
| H4a-R12 | Nhân bản = bản nháp trong UI từ agent gốc (key mới nhập, `enabled=false`); chưa lưu thì chưa gọi API | ui §5.1 |
| H4a-R13 | Secret không ra response `/studio/api/*`: `providers` trả `has_secret: bool`, không trả `secret_id`/ciphertext | FR-68 (bối cảnh) |
| H4a-R14 | Đăng nhập: Studio không có endpoint login riêng; dùng `POST /auth/login` của Admin (Q2). Token chỉ giữ trong bộ nhớ; 401 giữa chừng → về trang đăng nhập, giữ URL đích | FR-72, ui §3 |

## 3. Contract (backend-lead)
<!-- backend-lead -->
File: `packages/contracts/src/studio/{index,errors,common,agents,orchestrator,catalog}.ts` (`@ai/contracts/studio`, zod; FE + Hub dùng chung). **Chi tiết từng trường: [plan §2](plan.md#2-contract-aicontractsstudio); endpoint × lỗi: [plan §3](plan.md#3-endpoint--lỗi-mọi-route-401-auth_expired--403-forbidden-trước-parse).** Mọi route: role `platform_admin`; thứ tự lỗi 401 `AUTH_EXPIRED` → 403 `FORBIDDEN` → 400 → 404 → 409/422.

| Method · path | Request | Response | Lỗi riêng |
|---|---|---|---|
| `GET /studio/api/me` | — | `Me {user_id, tenant_id, role, hub_config_version}` | — |
| `GET /studio/api/agents` | `q?, runtime?, enabled?, limit 1–200 = 200, offset` | `{items: AgentListItem[], total, truncated, hub_config_version}` | 400 |
| `POST /studio/api/agents` | `AgentCreate` (union theo `runtime`, `bash_ack?`) | 201 `{agent, hub_config_version}` | 400 `VALIDATION_ERROR`/`INVALID_REFERENCE`, 409 `KEY_TAKEN`, 422 `BASH_ACK_REQUIRED` |
| `GET /studio/api/agents/:id` | — | `Agent` (+ `orchestrator_of`, `warnings`) | 404 |
| `PUT /studio/api/agents/:id` | `AgentUpdate` (không `key`/`runtime`) + `version` | 200 idem | 404, 409 `VERSION_CONFLICT`/`AGENT_IN_USE_AS_ORCHESTRATOR`, 422 |
| `PATCH /studio/api/agents/:id/enabled` | `{enabled, version}` | 200 idem | 404, 409 idem |
| `DELETE /studio/api/agents/:id?version=` | — | 204 | 404, 409 `VERSION_CONFLICT` → `AGENT_IN_USE_AS_ORCHESTRATOR` → `AGENT_HAS_HISTORY` → `AGENT_HAS_ACCESS` |
| `GET /studio/api/orchestrator` | — | `{default, tenants[], hub_config_version}` | — |
| `PUT /studio/api/orchestrator/default` | `OrchestratorInput` + `version` | 200 `{orchestrator, hub_config_version}` | 400 `INVALID_REFERENCE`, 409 `VERSION_CONFLICT`/`AGENT_NOT_ORCHESTRATABLE` |
| `DELETE /studio/api/orchestrator/default` | — | — | 409 `ORCHESTRATOR_DEFAULT_PROTECTED` |
| `POST /studio/api/orchestrator/tenants` | `OrchestratorInput` + `tenant_id` | 201 | 400, 409 `TENANT_INACTIVE`/`ORCHESTRATOR_EXISTS`/`AGENT_NOT_ORCHESTRATABLE` |
| `PUT·DELETE /studio/api/orchestrator/tenants/:tenant_id` | Input+`version` · `?version=` | 200 · 204 | 404, 409 |
| `GET /studio/api/{agent-types,model-profiles,providers,workflows,tenants}` | `q?, limit ≤ 200` | `{items, total, truncated, hub_config_version}` | 400 |

Ràng buộc trường theo CHECK DB (QB2): `key` `^[a-z][a-z0-9-]{1,47}$` · `description` 20–400 · `timeout_s` 10–3600 · `token_budget` 1–10⁷ \| null · Orchestrator `max_steps` 1–20, `token_budget` 1000–10⁷, `history_n` 1–50. `truncated=true` (> `limit`): FE hiện Alert vàng "Chỉ hiện 200 agent đầu. Dùng ô tìm để lọc trên máy chủ." (EN "Showing the first 200 agents. Use search to filter on the server.") và ô tìm chuyển sang `?q=` phía server ([plan-frontend §3](plan-frontend.md)). Luật thuần (QC test trước): [plan §4](plan.md#4-luật-thuần-qc-viết-test-trước--testsacceptanceh4arules). Sự kiện: `hub_config_changed` (có từ H1, payload không đổi).

## 4. Dữ liệu (backend-lead)
<!-- backend-lead -->
Không bảng mới. Migration **`migrations-hub/0010_h4a_studio.sql`** ([plan §6](plan.md#6-db--migration-packagesdbmigrations-hub0010_h4a_studiosql--metajournaljson-idx-10)):

| # | Thay đổi | Dữ liệu cũ |
|---|---|---|
| D1 | `hub_rw` được `INSERT/UPDATE/DELETE` `agents`, `agent_workflows`, `orchestrator_settings` + `USAGE` sequence `orchestrator_settings_id_seq` | — |
| D2 | `agents.profile_id` cho NULL + CHECK bắt buộc với `llm`/`agentic-cli` (QB4) | không đổi |
| D3 | `audit_log.tenant_id` cho NULL (cấu hình toàn hệ thống, QB6); CHECK `action` + `create/update/delete/enable/disable`, `entity` + `agent/orchestrator` | thoả CHECK mới |
| D4 | Index `runs_agent_idx`, `run_steps_agent_idx` (partial `agent_id IS NOT NULL`) cho `AGENT_HAS_HISTORY` | prod: `CONCURRENTLY` thủ công |

**Cách ly:** bảng cấu hình không RLS — chặn bằng `requirePlatformAdmin` ở mọi `/studio/api/*`; transaction Studio dùng scope `system` (đọc `runs`/`run_steps` có RLS khi kiểm lịch sử). Audit: agent + Orchestrator mặc định `tenant_id` NULL (đọc theo tenant không thấy), Orchestrator tenant ghi tenant đích. Ghi an toàn (R09): `config_meta` FOR UPDATE đầu tiên → hàng đích FOR UPDATE → kiểm `version` → ghi → bump → audit → NOTIFY, một transaction ([plan §5.1, §7](plan.md#7-thứ-tự-khoá--đồng-thời)). `dify-*` ghi cả `runtime_options.workflow_key` lẫn `agent_workflows` (QB3). Đọc `admin.workflows`/`admin.tenants` bằng `hub_ro`.

## 5. UI (frontend-lead)
<!-- frontend-lead -->
Chi tiết: [`plan-frontend.md`](plan-frontend.md) (route, trạng thái, validate, nhãn e2e, bundle, đề xuất API E1–E12) · câu chữ VI/EN: [`plan-frontend-copy.md`](plan-frontend-copy.md).

| Màn | Route (basepath `/studio`) | Artboard / mẫu | Ghi chú |
|---|---|---|---|
| Đăng nhập (+ bước TOTP) | `/login?next=` | **mới**, mẫu Admin ui-admin §7.1 | `POST /auth/login`, `/auth/totp/verify`; `password_change_required` → chuyển sang Admin |
| Không có quyền | `/forbidden` | **mới**, mẫu Admin `state.forbidden` | `me` 403 ⇒ tới đây, không gọi API khác |
| Khung + menu | mọi route `_authed` | Main (sidebar/topbar) | mục chưa làm `aria-disabled` + "Sắp có"; badge `hub config vN`; "⇄ Admin" |
| Agents | `/agents`, `/` → `/agents` | Main, bỏ cột "24 giờ", bỏ Import yaml | lọc client; bật/tắt có Hoàn tác; menu Nhân bản / Đặt làm Orchestrator / Xoá |
| Agent editor | `/agents/new[?from=<id>]`, `/agents/$agentId` | AgentEditor, nút "Lưu" (không kiểm thử định tuyến) | Chạy thử, "Xem như model thấy" disabled "Sắp có (H4c)"; bước 5 chỉ số tenant |
| Orchestrator | `/orchestrator[?tenant=<id>\|new]` | Orchestrator, bỏ tab Kiểm thử, Dry-run, cột Kiểm thử | bản tenant trong Sheet |
| 404 | `*` | mẫu Admin `state.notFound` | — |

Trạng thái: tải (skeleton) · rỗng (ui §13) · lỗi (+ Thử lại) · không quyền · 409 `VERSION_CONFLICT` (ConflictDialog mẫu Admin) · mất mạng (banner) — bảng plan-frontend §3. Dev: rsbuild 3200, base `/studio`, proxy `/auth` → admin-api, `/studio/api` → Hub (cookie refresh không cần CORS); prod `/auth` cần reverse proxy hoặc CR-044. Không thêm thư viện (không ADR).
## 6. Hiệu năng
Theo `CONVENTIONS.md` §6; hiệu năng không chặn mốc (người dùng 2026-10-03). Mục tiêu bundle JS đầu ≤ 150 KB gzip (nới được).
BE: `/studio/api/*` CRUD p95 < 300 ms với 5 000 agent; mọi list `limit` ≤ 200; mỗi ghi ≤ 8 câu SQL + audit; index từng truy vấn ở [plan §8](plan.md#8-hiệu-năng-conventions-6-spec-6--đo-không-chặn) (mới: D4).

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách giả lập khi dev/test |
|---|---|
| Đăng nhập (`admin-api /auth/login`) | dev: admin-api thật trên Postgres dev (seed `platform_admin`); test FE: mock http; test BE: ký JWT bằng khoá test như H3b |
| Catalog `admin.workflows` | fixture DB test (đã có từ H2a); không gọi Dify |
| Agent/profile/Orchestrator | seed yaml H1–H2b; provider giả `fake-cli` |
| `agent_types` | Runtime ghi; test chèn fixture |

Env mới (theo [plan-frontend D3/D4](plan-frontend.md)): `HUB_STUDIO_DIST` (thư mục build phục vụ ở `/studio`; vắng hoặc thiếu `index.html` thì không mount, `/studio` 404 JSON; test truyền `AppDeps.studioDist`) · `HUB_CORS_ORIGINS` thêm `http://localhost:3200` · FE gọi API bằng đường tương đối; `PUBLIC_AUTH_URL` (vắng = tương đối), `PUBLIC_ADMIN_WEB_URL` (dev `http://localhost:3000`), `PUBLIC_CHAT_WEB_URL` (dev `http://localhost:3100`); build/dev-proxy: `ADMIN_API_URL`=`http://localhost:3001`, `HUB_URL`=`http://localhost:4020`. Cổng dev Studio 3200 (Admin 3000, Chat 3100).

## 8. Tiêu chí nghiệm thu (qc)
Khung — AC chi tiết (Given/When/Then đầy đủ) ở [test-plan §3](test-plan.md):

| AC | Given / When / Then | Test |
|---|---|---|
| H4a-AC-01 | JWT `tenant_admin`/`member` → mọi `/studio/api/*` 403 `FORBIDDEN`; không token 401; UI hiện "Bạn không có quyền vào Agent Studio" (FR-72) | int + e2e |
| H4a-AC-02 | `platform_admin` đăng nhập → danh sách agent seed (≥ 1) đúng runtime/profile, badge Orchestrator đúng agent | e2e |
| H4a-AC-03 | Tạo agent `llm` hợp lệ → 201, có trong danh sách, `audit_log` +1 dòng (before null), `hub_config_version`+1, NOTIFY ≤ 1 s; thiếu `name.en` → 400 chỉ rõ trường | int |
| H4a-AC-04 | Hai tab cùng sửa agent: tab 2 lưu `version` cũ → 409 `VERSION_CONFLICT`, UI hiện modal xung đột, không đè dữ liệu tab 1 | int + e2e |
| H4a-AC-05 | Gắn workflow tắt/không tồn tại → 400 `INVALID_REFERENCE`; `dify-workflow` gắn 2 workflow → 400; hợp lệ → `agent_workflows` có dòng; picker không liệt kê workflow tắt | int |
| H4a-AC-06 | Chọn `Bash` không `bash_ack` → 422 `BASH_ACK_REQUIRED`; có ack → lưu | int + e2e |
| H4a-AC-07 | Tắt/xoá agent đang là Orchestrator → 409 `AGENT_IN_USE_AS_ORCHESTRATOR`; xoá agent có run → 409 `AGENT_HAS_HISTORY` | int |
| H4a-AC-08 | Thêm Orchestrator cho tenant `acme` → 201; lần 2 → 409 `ORCHESTRATOR_EXISTS`; xoá bản mặc định bị từ chối; run mới của user `acme` ghi đúng bản tenant trong snapshot, tenant khác vẫn dùng mặc định (CR-032) | int |
| H4a-AC-09 | Sau lưu agent, run mới ≤ 5 s dùng `system_prompt`/profile mới; run đang chạy giữ bản cũ (BR-06) | int (fake-cli) |
| H4a-AC-10 | Response `/studio/api/providers` không chứa secret/ciphertext (R13) | int |
| H4a-AC-11 | Hub phục vụ `/studio` từ `HUB_STUDIO_DIST` cùng origin; reload sâu `/studio/agents/x` trả `index.html` (SPA fallback) | int |

Lệnh xong: `done:h4a` (qc, mẫu `done:h3b`) = `bun run typecheck && bun test && bun run test:int` (hub-api) + `bun run e2e:studio` (= `playwright test -c e2e/studio/playwright.config.ts`) + `bun run trace --check` + `check:bundle` studio-web. Script `done:h4a` = `tools/scripts/src/done-h4a.ts` (task I1).

## 9. Quyết định
### Trước Gate (đã chốt với người dùng)
- 2026-10-06: làm **H4 Studio trước H3c**; H3c vẫn tạm dừng. H3c/H2d không kéo vào H4a (Đơn giá → H4d; provider API thật hoãn theo H2d).
- 2026-10-04: canvas 6 artboard duyệt hướng; chỉ `platform_admin` vào Studio; Orchestrator = một agent được chọn (CR-020, 025, 032).

### Đã chốt với người dùng (2026-10-06, readiness lần 1)
| # | Quyết định | Ghi chú |
|---|---|---|
| U1 | **Người dùng chấp nhận** nguyên gói mặc định Q1–Q9, QB2–QB7, QF1–QF3 và G1–G13 (qc) | gồm xoá cứng có điều kiện (Q6), audit `tenant_id` NULL (QB6), lưu `Edit`/`Bash` kèm cảnh báo (QB7) |
| U2 (QB1) | **Người dùng chấp nhận**: chỉ `agentic-cli` làm Orchestrator; hằng `ORCHESTRATOR_RUNTIMES` chuyển vào `@ai/contracts/studio` (hub `config.rules` import lại, FE lọc theo hằng) | thu hẹp CR-020 tới khi `llm` chạy (H2d); mở lại = sửa một hằng |
| U3 (Q10) | **Người dùng chấp nhận**: F1 chỉ **thêm** 1 export `./studio-locales` vào `packages/i18n/package.json` + 1 nhánh `studio/` vào `tools/scripts/src/i18n-check.ts` (không đổi chuỗi Admin/Chat) | thay ràng buộc "dừng và hỏi" của Q10 |
| U4 (Q3/D4) | **Người dùng chấp nhận**: prod cần reverse proxy `/auth` cùng origin Hub; chưa có thì tải lại = đăng nhập lại tới CR-044 | I3 ghi mục chờ vào PRODUCTION-NOTES (không sửa lúc này) |

### Câu hỏi mở — ĐÃ CHỐT (U1–U4, 2026-10-06, người dùng chấp nhận mặc định)
| # | Câu hỏi | Mặc định đề xuất | Nếu đổi |
|---|---|---|---|
| Q1 | App UI đặt ở đâu? | **`apps/studio-web` mới** (Rsbuild+React+Tailwind+shadcn, ADR-0001), cổng dev 3200. **Không** import từ `apps/admin-web`. Chưa có `packages/ui`: copy-then-own các primitive shadcn cần + token (`canvas/tokens-map.md`); ghi TECH-DEBT "rút `packages/ui` dùng chung" | Tạo `packages/ui` ngay = phải sửa Admin/Chat → ngoài phiên, cần phiên Admin |
| Q2 | Ai đăng nhập, bằng gì? | **Chỉ `platform_admin`** (FR-72). Form mã công ty + username + mật khẩu, gọi `admin-api POST /auth/login`; role khác đăng nhập được nhưng thấy trang "không có quyền" | Login riêng ở Hub = trùng logic auth, lệch ui §3 |
| Q3 | Chung phiên với Admin? | Chung **tài khoản, chưa chung phiên**: token trong bộ nhớ; refresh qua cookie admin-api cần CORS `credentials` ở admin-api → **CR-044**. Chưa có thì đăng nhập lại khi token hết hạn — vẫn chạy được | Chung phiên một chạm cần CR-044 |
| Q4 | `/studio/api/*` ở đâu? | `apps/hub-api` module `modules/studio/*` (route mỏng + service + repo, mẫu `agent-grants`); contract `@ai/contracts/studio` | Service riêng trái FR-72 "cùng origin" |
| Q5 | Hub phục vụ UI thế nào? | Hono serve tĩnh `HUB_STUDIO_DIST` ở `/studio/*` + SPA fallback; dev dùng rsbuild + CORS 3200 | Reverse proxy → PRODUCTION-NOTES |
| Q6 | Xoá agent cứng hay mềm? | **Cứng có điều kiện** (R06); có lịch sử thì chỉ Tắt | Mềm = thêm `deleted_at` + lọc mọi truy vấn Hub |
| Q7 | Lưu thay đổi định tuyến khi chưa có bộ câu kiểm thử? | **Lưu thẳng** (BR-13 chỉ chặn khi có bộ câu); H4c thêm chặn (`422 ROUTING_REGRESSION`, `override_reason?`) mà không đổi contract lưu | Chặn từ H4a = làm dry-run trước |
| Q8 | `codex`/`gemini` trong editor (H2d hoãn)? | Hiện, lưu được, cảnh báo "chưa chạy được" (R05) | Ẩn hẳn rồi làm lại ở H2d |
| Q9 | Nút "⇄ Agent Studio" phía Admin? | Không làm ở H4a (file Admin) → CR-044; Studio có link "⇄ Admin" tới `PUBLIC_ADMIN_WEB_URL` | — |
| Q10 | Chuỗi i18n để ở đâu? | `packages/i18n` thêm namespace `studio` bằng **file mới**, không sửa chuỗi/file Admin; nếu cấu trúc ép sửa file chung → dừng và hỏi | Đặt chuỗi trong `apps/studio-web` |
| QB1 | (U2) R07 cho `llm` làm Orchestrator, nhưng Hub chỉ chạy Orchestrator `agentic-cli` (`orchestratorProblem`) → lưu `llm` làm mặc định hỏng định tuyến mọi tenant | **Chỉ `agentic-cli`** tới khi `llm` chạy được; 409 `AGENT_NOT_ORCHESTRATABLE` (plan P9) | Cho lưu = Hub lỗi định tuyến |
| QB2 | Số trong R03/R07 lệch CHECK DB (key không `_`; mô tả 1–1000 vs 20–400; timeout ≥ 1 vs ≥ 10; `history_n` 0 vs 1) | **Theo DB** — §3 thắng R03/R07 (khớp ui §13, Runtime) | Migration nới CHECK + Runtime |
| QB3 | `dify-*` lưu workflow ở đâu (Runtime H2a đọc `runtime_options.workflow_key`)? | **Cả hai**: `workflow_key` + 1 dòng `agent_workflows`; `dify-agent` nhận app `chat`\|`agent` như seed | Chỉ một nơi = sửa Runtime hoặc Admin mất chặn xoá |
| QB4 | `agents.profile_id` NOT NULL mà R03 bỏ profile cho `dify-*` | Migration D2 (NULL + CHECK) | Server gán profile giả |
| QB5 | `key`, `runtime` đổi được sau tạo? | **Bất biến** (đổi runtime = Nhân bản, R12) | Kiểm lại workflow/Orchestrator mỗi lần đổi |
| QB6 | `audit_log.tenant_id` của cấu hình toàn hệ thống | **NULL** (D3); Orchestrator tenant ghi tenant đích | Tenant của actor ⇒ lẫn vào audit tenant đó |
| QB7 | Tool `Edit`/`Bash` (Runtime chỉ chạy `Read/Grep/Glob/Write`); JSON Schema của `python` | Lưu được + `warnings`; Hub không kiểm JSON Schema (không ajv, không ADR) | ADR thêm ajv |

### Trong lúc làm (agent tự quyết theo Luật 2)
- B1: `packages/db/src/hub-h3b.int.test.ts` (test unit/int của backend, không phải QC) sửa kỳ vọng `audit_log.tenant_id` NOT NULL → nullable theo D3.
- B3: `GET me` đọc DB một câu (`admin.users` ⋈ `admin.tenants` + `hub.config_meta`) thay vì "không query" (plan §5.4) — cache cấu hình chỉ giữ trạng thái, không có `username`/`display_name`/`tenant_key` mà `MeSchema` bắt buộc; `hub_config_version` của `me` và mọi list catalog đọc trong cùng transaction read only (khớp DB ngay sau ghi, không chờ NOTIFY).
- B3: `usable_for` = `tool` cho mọi workflow bật; `dify-workflow` ⇔ app `workflow` ∧ `difyAgentInput ≠ null`; `dify-agent` ⇔ app `chat|agent` ∧ `difyAgentInput ≠ null` (QB3). Lọc `q` catalog: chứa chuỗi, không phân biệt hoa thường, trên key/tên (agent-types thêm mô tả vi/en; providers thêm vendor/kind).
- B3: tĩnh `/studio` đăng ký trong `mountH4a` (sau route `/studio/api`, cùng tiền tố); route ngoài `/studio` không giao nhau nên không cần mount cuối `createApp` — giữ `app.ts` ≤ 250 dòng.

## 10. Tranh chấp test
- **B1 · `tests/acceptance/H3b/db-grants.int.test.ts` A122** (khoá H3b) kỳ vọng `hub_rw` không có quyền ghi `hub.agents`/`hub.orchestrator_settings` (`agents: []`, `orch: []`) — mâu thuẫn plan §6 D1 đã duyệt Gate (Studio ghi qua `hub_rw`). Sau 0010: `agents: [INSERT, UPDATE, DELETE]`, `orch: [INSERT, UPDATE, DELETE]` ⇒ A122 đỏ (1/133 H3b). Đề xuất qc: cập nhật kỳ vọng A122 theo D1 (giữ `ent: []`). Backend không sửa test.
  - **Phân xử qc (2026-10-06): TEST SAI (lỗi thời), code đúng.** A122 chỉ phản ánh phạm vi H3b (G11 liệt kê theo `0000` + `plan-db` trước `0009`); H4a plan §6 D1 cấp `hub_rw` ghi `agents`/`agent_workflows`/`orchestrator_settings` + USAGE sequence, đã qua Gate H4a (`H4a-gate.md` §2) — BA H4a (Studio ghi cấu hình từ API) thay phạm vi, không phải code vượt quyền. Sửa A122 giữ danh sách trắng **tường minh**: `agents` = `agent_workflows` = {S,I,U,D}; `orchestrator_settings` ghi = {I,U,D}; `has_sequence_privilege(hub_rw, orchestrator_settings_id_seq, USAGE)` = true; `agent_entitlements` ghi vẫn `[]`; các vế khác giữ nguyên (không có TRUNCATE ở đâu). `db-grants.int.test.ts` 7/7 xanh (DB qc `ai_system_h3b_qw_hub_test`, Redis 15); `tests/.lock` ghi lại + verify OK.
  - Độ phủ D1 ở tests H4a: không có ca nào khẳng định quyền trực tiếp (`has_*_privilege`); chỉ phủ gián tiếp qua API (`agents-write`, `orchestrator`). Nay A122 phủ đủ D1 (gồm `agent_workflows` + sequence) nên không viết thêm ca H4a.
