---
id: H3b-agent-grants
title: Quyền agent — `/agent-grants` (cấp/thu hồi agent cho group/user), Kiểm tra quyền phần agent, trace run theo role + audit `view_trace`
milestone: H3b
status: draft                     # draft → ready → approved → in-progress → done
requirements:
  [HUB-FR-78, HUB-FR-79, HUB-FR-52, HUB-FR-87, HUB-BR-17, HUB-BR-02, HUB-BR-14, HUB-BR-06 (bối cảnh), HUB-FR-77 (bối cảnh, không đổi),
   ADM-FR-37 (vế Hub), ADM-FR-36 (vế agent — dữ liệu Hub), AC-H08 (vế trace), AC-H09 (vế grant), AC-A11 (vế Hub, phần agent)]
design:
  - docs/design/agent-hub/ba-agent-hub.md (§2 Actor; §6.6 HUB-FR-52; §6.8 HUB-FR-77, 78, 79, 87; §7 HUB-BR-02, 06, 14, 17; §8 `agent_grants`, `agent_entitlements`, `audit_log`/`config_meta`; §9.1 `/agent-grants`, `/agent-grants/effective/:user_id`, `GET /runs/:id/trace`; §11 AC-H08, AC-H09)
  - docs/design/admin/ba-admin.md (§5.5 ADM-FR-36, 37; §5.7 ADM-FR-51, 53, 55; §8 đoạn cuối "Cấp agent cho group được Admin UI gọi sang `hub/agent-grants`"; §11 AC-A10, A11)
  - docs/design/admin/ui-admin.md (§7.14 Groups tab *Agent*; §7.15 Kiểm tra quyền; AccessExplainer) — chỉ để biết Admin cần gì (CR-impact)
  - docs/design/agent-hub/ui-operations.md (§4 trace; §8 "Riêng tư" — `view_trace` khi mở trace *của người khác*)
  - docs/specs/M3-permissions/spec.md (M3-R05 tập hợp không `version`, R07 `NOT_ENTITLED`, R11–R12 effective-access + mã lý do, R15–R16 `config_version`/NOTIFY) — mẫu để khớp cách Admin làm
  - docs/ROADMAP.md (M5, H3b) · CR-015 (vế Hub AC-A03/A10/A11 → M5)
owner: backend-lead (chỉ Hub TS + `packages/**`; không Python)
---

# H3b · Quyền agent + trace theo role

Mốc con **thứ hai** của H3 (chia ở `5ca15d8`, lý do: [H3a spec-decisions](../H3a-subscription/spec-decisions.md) D1). Đóng **M5 phần agent** (ADM-FR-37 vế Hub, phần agent của Kiểm tra quyền). Quyết định + câu hỏi mở: [spec-decisions.md](spec-decisions.md). AC: [spec-ac.md](spec-ac.md). Luật đánh số `H3b-Rnn`. Không chép BA — chỉ phần cụ thể hoá.

## 0. Hiện trạng (code thắng tài liệu — đã đọc 2026-10-06)
| Đã có từ H1/H2 | Ở đâu |
|---|---|
| Luật thấy agent `visibleAgents` (bật ∧ entitlement chưa thu hồi ∧ grant user/group ∧ ∉ Orchestrator mọi phạm vi ∧ runtime chạy được `RUNNABLE_RUNTIMES`), áp ở `GET /agents`, `@agent`, delegate, tạo run; tính trên ảnh run (HUB-BR-06) | `apps/hub-api/src/modules/agents/agent-access.rules.ts` (`accessInput`, `orchestratorIds`) |
| `GrantRow` chỉ có `subject` (uuid user hoặc group, không `subject_type`); nhóm của user lấy từ `admin.group_members` (cùng tenant) | `agent-access.rules.ts`, `modules/config/config.repo.ts` `loadUsers` |
| Entitlement/grant **chỉ** tạo qua seed YAML (owner, `bun run hub:seed`): `hub_config_version + 1` + `pg_notify('hub_config_changed', {v, version})` **trong** transaction | `modules/seed/seed.repo.ts` (`bumpHubConfigVersion`, `notifyHubConfigChanged`) |
| Cache cấu hình nạp lại khi LISTEN `config_changed` (Admin) / `hub_config_changed` (Hub) + poll version | `modules/config/config.service.ts` |
| Bảng `hub.agent_grants` (id, agent_id, tenant_id, subject_type `group\|user`, subject_id, granted_by, granted_at; unique `(agent_id, tenant_id, subject_type, subject_id)`; FK agent) — **kiểu Drizzle ở `hub-readonly.ts`** (stub cho Admin đọc); không FK sang `admin.groups/users` (khác schema); **không RLS** | `packages/db/migrations-hub/0000_hub_core.sql`, `packages/db/src/schema/hub-readonly.ts` |
| Quyền DB: `hub_rw` chỉ **SELECT** `agent_grants`, `agent_entitlements`, `config_meta`; `admin_rw` SELECT `agent_grants` (Admin đọc) | `0000_hub_core.sql` §GRANT |
| **Không có** bảng audit trong schema `hub`; `admin.audit_log` (M4) append-only, CHECK `action`/`entity` theo danh sách Admin, Hub chỉ đọc schema `admin` | `packages/db/src/schema/ops.ts` |
| `GET /runs/:id` (chủ run, RLS scope `user` = tenant + user); **chưa có** `GET /runs/:id/trace`; RLS `runs`/`run_steps`/`messages`: scope `system` thấy hết | `modules/runs/runs.routes.ts`, `runs.service.ts`, `0001_hub_rls.sql` |
| `run_steps`: type `orchestrator\|delegate\|workflow\|tool`, `agent_id`, `workflow_id`, `provider_key`, `job_id`, `label_key`, `status`, `detail` jsonb, thời gian | `0000`, `0002_h2a_dify.sql`, `lib/run-steps.ts` |
| JWT `{sub, tid, role ∈ platform_admin\|tenant_admin\|member}` | `lib/jwt.ts`, `lib/auth.middleware.ts` |
| CORS `HUB_CORS_ORIGINS` (mặc định chỉ chat-web `http://localhost:3100`); admin-web dev cổng 3000 | `config/env.ts`, `app.ts`, `apps/admin-web/rsbuild.config.ts` |
| Admin `effective-access` trả `agents: {available:false}`; tab Agent của group "Chưa khả dụng"; `agent_count = 0` | `apps/admin-api/src/modules/access/access.service.ts` (M3 — **không sửa phiên này**) |
| Admin-api **không** gọi Hub (không `HUB_URL`) | grep `apps/admin-api/src` |

**H3b lấp:** (1) không có cách quản lý grant ngoài seed; (2) Admin không có dữ liệu "agent user thấy được kèm lý do"; (3) không có trace API + luật xem theo role + audit `view_trace`; (4) Hub không có nơi ghi audit.

## 1. Phạm vi
| # | Làm | Mã |
|---|---|---|
| 1 | `GET/POST/DELETE /agent-grants` (role, tenant đích, chỉ agent có entitlement, subject cùng tenant, idempotent, audit, `hub_config_version` + NOTIFY) | HUB-FR-78, HUB-BR-17, ADM-FR-37 (vế Hub) |
| 2 | `GET /agent-grants/effective/:user_id` — agent user thấy được + lý do, cả agent **không** thấy + tầng chặn (dữ liệu cho AccessExplainer) | HUB-FR-79, ADM-FR-36 (vế agent) |
| 3 | `GET /runs/:id/trace` + luật xem theo role + audit `view_trace` | HUB-FR-52, 87, HUB-BR-02, 14; AC-H08 |
| 4 | Nơi ghi audit của Hub (Q-U3) + migration quyền ghi `agent_grants` | HUB-FR-78, 87 |
| 5 | CORS cho origin admin-web (env) | — |
| 6 | Test vế Hub AC-H09 (grant ≤ 5 s), AC-A11 phần agent (thu hồi entitlement → mất, cấp lại → grant cũ hiệu lực) | AC-H09, AC-A11 |

**Không làm (H3b):** API entitlement agent cho tenant (`/studio/api/agent-entitlements`, platform_admin — Studio H4; test dựng entitlement bằng seed/SQL); danh sách run `/studio/api/ops/*`, waterfall UI (H4); quota, `price_book`, `billable_usd` (H3c — trace trả số đang có trong `usage_logs`); **mọi UI Admin** (tab Agent của group, AccessExplainer phần agent, cột `agent_count`) → CR-impact phiên Admin (§5); sửa `apps/admin-*`, `apps/chat-web`; Python/Agent Runtime; Dify thật; e2e 3 app (chờ người dùng ghép).

## 2. Nghiệp vụ
### 2.1 Ai được gọi, tenant nào (rủi ro cao — cách ly tenant + role)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H3b-R01 | Mọi `/agent-grants*`: `role ∈ {tenant_admin, platform_admin}`; `member` → **403 `FORBIDDEN`** (Q-K3), không đọc DB. JWT không hợp lệ → 401 như hiện có | BA-H §9.1, HUB-FR-74 |
| H3b-R02 | **Tenant đích** `T`: `tenant_admin` → luôn `T = JWT.tid`; gửi `tenant_id` ≠ `tid` → **404** (không 403, HUB-BR-14). `platform_admin` → `T = ?tenant_id` (Q-U1; vắng → 400 `TENANT_REQUIRED`, như Admin M3); tenant không tồn tại → 404. `T` lấy **một lần** ở đầu request, mọi truy vấn lọc `tenant_id = T` | HUB-BR-14, 17; M3 |
| H3b-R03 | Không có RLS trên `agent_grants` (bảng cấu hình, cache đọc toàn bộ): cách ly bằng **mọi** câu `WHERE tenant_id = T` ở repo + test chéo tenant bắt buộc (AC-01, 03). Thêm RLS = Q-K6 | HUB-FR-75 |

### 2.2 Cấp / thu hồi (HUB-FR-78, HUB-BR-17)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H3b-R04 | `POST /agent-grants` `{agent_id, subject_type: group\|user, subject_id}` (+ `?tenant_id` khi platform_admin). Kiểm theo thứ tự: body hợp lệ (400 `VALIDATION_ERROR`) → R02 → agent tồn tại (vắng → 400 `INVALID_REFERENCE {field:"agent_id"}`) → agent **không** là Orchestrator ở phạm vi nào (409, mã backend-lead chốt, gợi ý `AGENT_NOT_GRANTABLE`) → entitlement **chưa thu hồi** cho `T` (vắng/thu hồi → 409 `NOT_ENTITLED {agent_ids}`; **cả `platform_admin` không bỏ qua**, như M3-R07) → subject thuộc `T` (group: `admin.groups.tenant_id = T`; user: `admin.users.tenant_id = T`; không có / tenant khác → 400 `INVALID_REFERENCE {field:"subject_id"}` — không phân biệt hai ca để không lộ tồn tại) | HUB-BR-17, M3-R07 |
| H3b-R05 | Agent **tắt** hoặc runtime chưa chạy được vẫn cấp được (lưu, chưa hiệu lực — như feature `off` ở M3); user `inactive` vẫn nhận grant được | M3-R07 |
| H3b-R06 | Grant là **tập hợp, idempotent, không `version`, không 409 xung đột** (M3-R05; ADM-FR-55 không áp). Cấp trùng → 200 hàng có sẵn, **không** bump, **không** audit, **không** NOTIFY. Mới → 201. Hai POST đồng thời cùng khoá → đúng 1 hàng, đúng 1 bump (unique + `on conflict do nothing`) | M3-R05 |
| H3b-R07 | `DELETE /agent-grants?agent_id&subject_type&subject_id` (+ `tenant_id` khi platform_admin; Q-K4): có hàng trong `T` → xoá cứng, 204, bump + audit `revoke` + NOTIFY; không có (hoặc thuộc tenant khác) → 204, không ghi gì | M3 `DELETE /admin/grants` |
| H3b-R08 | Mỗi ghi **có đổi**: trong **một** transaction — khoá `hub.config_meta` (`bumpHubConfigVersion`, khoá đầu tiên như seed) → ghi `agent_grants` → ghi audit (R16) → `pg_notify('hub_config_changed', {v, version})` (giao khi commit; rollback/retry 40P01 không gửi). `granted_by = JWT.sub` | HUB-FR-78, ADM-FR-53 |
| H3b-R09 | Hiệu lực ≤ 5 s sau 2xx: instance nhận NOTIFY nạp lại cache; lượt gửi **kế tiếp** của user dùng ảnh mới; run đang chạy giữ ảnh cũ (HUB-BR-06) | AC-H09 |
| H3b-R10 | Thu hồi entitlement (seed/H4) → grant trong tenant **giữ nguyên**, mất hiệu lực; cấp lại → hiệu lực lại không cần cấp lại (đã có trong `visibleAgents`; H3b thêm test) | HUB-FR-78, AC-A11 |
| H3b-R11 | `GET /agent-grants` (+ `?tenant_id` platform_admin; lọc tuỳ chọn `?subject_type&subject_id` cho tab Agent của một group): danh sách agent có entitlement **chưa thu hồi** cho `T`, trừ Orchestrator, sắp `key`; mỗi agent: `id, key, name{vi,en}, description, enabled, runnable`, `grants[]` (`id, subject_type, subject_id, subject_key/tên, granted_by, granted_at`) chỉ của `T`. Grant **mồ côi** (group/user đã xoá ở Admin) không trả (Q-K8); grant của agent đã bị thu hồi entitlement không nằm trong danh sách này (vẫn thấy ở R13) | BA-H §9.1 |

### 2.3 Kiểm tra quyền phần agent (HUB-FR-79)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H3b-R12 | `GET /agent-grants/effective/:user_id` (+ `?tenant_id` platform_admin): user không thuộc `T` → 404. Kết quả tính bằng **cùng** luật `visibleAgents`/`accessInput` trên ảnh cache hiện tại (một sự thật) — test chéo: tập `visible=true` ≡ `visibleAgents` | HUB-FR-77, 79 |
| H3b-R13 | Phạm vi danh sách = agent có entitlement **chưa thu hồi** cho `T` ∪ agent có grant trong `T` (để giải thích grant còn giữ khi entitlement đã thu hồi); trừ Orchestrator. Agent chưa từng liên quan tới `T` **không** trả (không lộ catalog của platform) | HUB-BR-17 |
| H3b-R14 | Mỗi mục `{agent, visible, reasons[], missing[]}` — `visible ⇔ missing = []`. `reasons`: `grant_user` · `grant_group {group}` (mọi group cấp). `missing` (thứ tự cố định): `user_inactive`, `tenant_locked`, `agent_disabled`, `runtime_unavailable`, `no_entitlement`, `no_grant`. `reasons` có cả khi không thấy (vd grant còn giữ khi `no_entitlement`). Khớp hình `EffectiveFeature` M3 để Admin gộp vào `EffectiveAccess.agents` (CR-impact) | M3-R12, ui-admin AccessExplainer |
| H3b-R15 | Trả kèm `hub_config_version` của ảnh dùng để tính; chỉ đọc, không khoá, không audit | M3 `config_version` |

### 2.4 Trace theo role (HUB-FR-52, 87; HUB-BR-02)
| Luật | Điều kiện chính xác | Nguồn |
|---|---|---|
| H3b-R16 | **Audit Hub** (Q-U3): bảng mới trong schema `hub`, append-only, cấu trúc theo `admin.audit_log` (tenant_id, actor_id, actor_username, action, entity, entity_id, before/after/summary, `hub_config_version`, at). Hành động H3b: `grant`/`revoke` (entity `agent_grant`), `view_trace` (entity `run`, `tenant_id` = tenant **của run**). Không ghi nội dung chat, prompt, secret | HUB-FR-78, 87; BA-H §8 |
| H3b-R17 | `GET /runs/:id/trace` — quyết theo thứ tự, **trước** khi đọc bằng scope `system`: (a) chủ run (`tenant_id = tid ∧ user_id = sub`, scope `user` như `GET /runs/:id`) → 200 đầy đủ, không audit; (b) `platform_admin` → 200 đầy đủ run **mọi tenant** (đọc scope `system`) + audit `view_trace` (Q-U4: chỉ khi không phải chủ run); (c) `tenant_admin` không phải chủ: **404** (Q-U2 mặc định — xem chi phí ở Admin "Chi phí & quota"); (d) còn lại (member không phải chủ, run tenant khác, id không có) → **404** giống hệt (AC-H07, AC-H08 — kể cả `tenant_admin`) | HUB-FR-52, 87, BR-14 |
| H3b-R18 | Nội dung trace: run (id, kind, status, error_code/message, config_version, conversation/flow, started/finished), `steps[]` theo `seq` (type, agent key, workflow, provider_key, model?, status, thời gian, ms, `detail`), `jobs[]` (id, type, status, attempts, error_reason), usage theo step (token vào/ra, `cost_usd`, `billable_usd` nếu có — H3c mới tính), tin user + câu trả lời. **Không** có secret/token job/khoá: backend-lead xác minh `detail` hiện ghi gì và che (`••••`) trước khi trả; test quét (AC-10). Hình chính xác: plan | HUB-FR-52, ui-operations §4 |
| H3b-R19 | Ghi audit `view_trace` **cùng transaction** đọc trace; ghi lỗi → 500, **không** trả trace (fail-closed, Q-K10). Mỗi lần gọi = một hàng (không gộp) | HUB-FR-87 |
| H3b-R20 | Trace không mở rộng `GET /runs/:id` hiện có; chat-web không dùng trace (contract chat không đổi) | H2c-R30 |

### 2.5 Tương thích
| Luật | Điều kiện | Nguồn |
|---|---|---|
| H3b-R21 | `@ai/contracts/chat` **không đổi**; `test:contract:chat` 41 ca xanh nguyên văn; test khoá H1–H3a xanh nguyên văn. Contract mới đặt ở gói Hub riêng (vd `@ai/contracts/hub-admin` — Q-K12) | — |
| H3b-R22 | Cột `hub.agent_grants` **không đổi** (Admin M3 `hub-view.int` đọc bằng `admin_rw` vẫn xanh); migration chỉ **thêm** GRANT `INSERT, DELETE` cho role Hub + bảng audit | ADM-NFR-06 |
| H3b-R23 | `HUB_CORS_ORIGINS` nhận thêm origin admin-web (env; dev `http://localhost:3000`); không `*`, không mặc định mở | — |

## 3. Contract (backend-lead)
<!-- backend-lead: zod cho AgentGrantList, AgentGrantCreate, AgentGrantDeleteQuery, AgentEffective (khớp EffectiveFeature M3), RunTrace; bảng endpoint × lỗi; hằng lỗi Hub-admin (FORBIDDEN, TENANT_REQUIRED, INVALID_REFERENCE, NOT_ENTITLED, AGENT_NOT_GRANTABLE, NOT_FOUND) -->

## 4. Dữ liệu (backend-lead)
<!-- backend-lead: migration 0009 (bảng audit hub + GRANT INSERT/DELETE agent_grants cho hub_rw + quyền audit), schema Drizzle (chuyển agentGrants khỏi stub chỉ đọc hay khai thêm ở hub.ts), thứ tự khoá (config_meta → agent_grants → audit), index cho R11/R13 -->

## 5. UI
Không có UI trong phiên này. **CR-impact phiên Admin** (docs-architect ghi `CR-xxx` khi đóng mốc, như CR-040/CR-042): (1) Groups › tab *Agent* gọi `GET/POST/DELETE hub/agent-grants?subject_type=group&subject_id=…` bằng JWT của admin đang đăng nhập (gọi **thẳng** Hub — BA-A §8, BA-H §9.1, architecture; Q-K1), thay "Chưa khả dụng"; (2) danh sách Groups cột *Agent* (`agent_count`) — Admin đọc `hub.agent_grants` (đã có quyền SELECT) hoặc từ `GET /agent-grants`; (3) AccessExplainer + tab "Quyền hiệu lực": gộp `GET hub/agent-grants/effective/:user_id` vào phần agent (`EffectiveAccess.agents` hiện `{available:false}`); (4) cấu hình URL Hub + origin CORS; (5) mã lỗi mới; (6) Nhật ký Admin chưa hiện audit Hub (Q-U3).

## 6. Hiệu năng (thấp ưu tiên — nới, đo ở `test:perf`, không chặn mốc)
| Chỉ tiêu | Ngưỡng | Đo bằng |
|---|---|---|
| Grant 2xx → lượt gửi kế của thành viên group thấy/delegate được agent | ≤ 5 s | int (LISTEN thật) |
| `GET /agent-grants`, `GET …/effective/:user_id` (200 agent × 200 group) | p95 < 300 ms | `test:perf` |
| `POST/DELETE /agent-grants` | p95 < 300 ms | `test:perf` |
| `GET /runs/:id/trace` (50 step) | p95 < 500 ms | `test:perf` |

## 7. Phụ thuộc & giả lập
| Phụ thuộc | Cách làm |
|---|---|
| Entitlement agent (platform_admin, H4) | Dựng bằng seed YAML / SQL owner trong test |
| Group/user (Admin) | Fixture `admin.*` như H2b (`beta-testers`), đọc bằng `hub_ro` |
| Admin UI | Không có — test gọi HTTP thẳng; CR-impact §5 |
| Agent Runtime / `claude-sub` | `fake-cli` cho run có step (trace); không smoke thật bắt buộc (Q-K14) |
| Dify | Không dùng thật; step `workflow` trong trace dựng bằng mock Dify H2a |

## 8. Tiêu chí nghiệm thu
Bảng AC: [spec-ac.md](spec-ac.md) (AC-H08 vế trace, AC-H09 vế grant, AC-A11 vế Hub phần agent, HUB-H3b-AC-01…14). Lệnh xong mốc: `done:h3b` (qc, mẫu `done:h3a`).

## 9. Câu hỏi mở
Q-U1…Q-U4 (cần người dùng — nghiệp vụ/bảo mật) và Q-K1…Q-K14 (kỹ thuật, tự quyết): [spec-decisions.md](spec-decisions.md). Không trả lời → dùng mặc định (Luật 2b).

## 10. Rủi ro
| # | Rủi ro | Giảm thiểu |
|---|---|---|
| K1 | `tenant_admin` thao tác tenant khác qua `tenant_id` / subject tenant khác | R02 (tenant đích một lần, 404), R04 subject cùng `T`, AC-01/03 test chéo, review Opus |
| K2 | Đọc trace bằng scope `system` lộ run tenant khác | R17: quyết role **trước** khi mở scope `system`; chỉ nhánh (b); AC-08/09 |
| K3 | Không RLS trên `agent_grants` — một câu thiếu `WHERE tenant_id` là lộ | R03; reviewer kiểm từng câu; Q-K6 RLS là phương án dự phòng |
| K4 | Xem trace không để lại dấu | R19 fail-closed, cùng transaction |
| K5 | Grant mồ côi khi Admin xoá group/user (không FK chéo schema) | R11/R13 lọc bằng join; dọn = TECH-DEBT (như #15) |
| K6 | CORS mở quá rộng khi thêm admin-web | R23 danh sách trắng theo env |
| K7 | Admin chưa áp CR → tab Agent vẫn "Chưa khả dụng" dù Hub có API | CR-impact ghi rõ; e2e 3 app chờ người dùng |

## 11. Tranh chấp test
(chưa có)
