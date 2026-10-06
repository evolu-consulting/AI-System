# H3b — Quyết định

## Trước SPEC — người dùng đã chốt (không hỏi lại)
| # | Quyết định | Áp vào |
|---|---|---|
| U1 | Phiên Hub/Worker: code H3b chỉ ở `apps/hub-api`, `apps/agent-runtime`, `packages/**`; UI Admin (tab Agent của group, Kiểm tra quyền phần agent) → **CR-impact phiên Admin** (như CR-040/CR-042), không có task UI trong phiên này | spec §1, §5 |
| U2 | Không chạm Dify thật; e2e tích hợp 3 app chờ người dùng ghép xong rồi yêu cầu | spec §7 |
| U3 | Trên `main`, không push; commit `git add -N` + `git commit -o` | — |
| U4 | Hiệu năng ưu tiên thấp: nới ngưỡng, đo ở `test:perf`, không chặn mốc | spec §6 |
| U5 | (CR-017, M3) UI Admin chỉ cấp cho group; cấp cho user chỉ có API — áp tương tự cho agent | spec R04, §5 |
| U6 | (2026-10-06) **Q-U1–Q-U4 theo mặc định:** Q-U1 `platform_admin` cấp/thu cho tenant khác với `?tenant_id` bắt buộc (tenant_admin chỉ tenant mình); Q-U2 tenant_admin mở trace run người khác ⇒ 404; Q-U3 audit Hub ở bảng mới `hub.audit_log` (CR cho Admin gộp trang Nhật ký); Q-U4 ghi `view_trace` chỉ khi xem run của người khác | Q-U1–Q-U4 |

## D1 · Phạm vi H3b (docs-architect)
Theo ROADMAP H3b + D1 của H3a: một spec (ước diff Hub TS ≈ 1 200–1 500 dòng: 3 endpoint grant + effective + trace + migration + audit). Không tách thêm vì cả ba khối dùng chung "role + tenant đích + audit Hub". Entitlement API (platform_admin) để H4 vì BA đặt ở Studio (`/studio/api/agent-entitlements`).

## Câu hỏi cần người dùng quyết (nghiệp vụ / bảo mật) — không trả lời ⇒ mặc định (Luật 2b)

### Q-U1 · `platform_admin` cấp agent cho group của tenant **khác** tenant trong JWT?
BA-H §9.1 ghi "chỉ trong đúng `tenant_id` của JWT"; nhưng ui-admin §5 cho `platform_admin` ô chọn tenant ở trang Groups, và Admin M3 `/admin/grants` nhận `?tenant_id` cho `platform_admin`.
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | `platform_admin` truyền `?tenant_id` (bắt buộc, vắng → 400 `TENANT_REQUIRED`) — giống Admin M3; `tenant_admin` luôn tenant JWT, `tenant_id` khác → 404. Cập nhật câu BA-H §9.1 khi đóng mốc |
| B | Đúng chữ BA: chỉ tenant JWT cho cả hai role ⇒ `platform_admin` không cấp được cho tenant khách (chỉ qua seed/H4) — trái màn Groups của Admin |

**Mặc định: A.**

### Q-U2 · `tenant_admin` mở trace run của user **khác** trong tenant mình?
HUB-FR-52/87, BR-02: `tenant_admin` "chỉ xem chi phí, không xem nội dung".
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | **404** như người ngoài; chi phí xem ở Admin "Chi phí & quota" (M4 đã có). Đơn giản, không có đường lộ nội dung |
| B | 200 **chỉ metadata** (step, agent, thời gian, token, chi phí; không tin, không `detail`) + audit `view_trace` | Thêm một hình trace thứ hai + luật che theo trường — rủi ro lọt nội dung qua `detail`/`label` |

**Mặc định: A.** Mở rộng B sau không phá contract (thêm nhánh).

### Q-U3 · Audit của Hub (cấp/thu grant, `view_trace`) lưu ở đâu, Admin "Nhật ký" có hiện không?
Schema `hub` chưa có bảng audit; `admin.audit_log` (M4) Hub chỉ đọc, CHECK `action`/`entity` không có `view_trace`/`agent_grant`.
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Bảng mới `hub.audit_log` (append-only, cấu trúc theo `admin.audit_log`, có `tenant_id`) — đúng BA-H §8 "`audit_log` … áp dụng cho cấu hình và quyền agent của Hub"; Studio (H4) đọc. Admin "Nhật ký" **chưa** hiện các hàng này → CR-impact Admin (đọc hợp nhất khi cần; cấp `SELECT` cho `admin_rw`) |
| B | Hub ghi thẳng `admin.audit_log` (phiên Admin mở `INSERT` cho role Hub + thêm giá trị CHECK) | Tenant admin thấy ngay trong Nhật ký; nhưng Hub ghi schema `admin` — trái nguyên tắc sở hữu (architecture), phải đổi migration phía Admin |

**Mặc định: A.**

### Q-U4 · Ghi `view_trace` khi nào?
BA-H HUB-FR-87: "mỗi lần xem trace"; ui-operations §8: "mỗi lần mở trace *của người khác*".
| Lựa chọn | Nội dung |
|---|---|
| **A (đề xuất)** | Chỉ khi người xem **không phải chủ run** (mỗi lần gọi một hàng); chủ run xem run của mình không ghi |
| B | Mọi lần, kể cả chủ run | Bảng audit phình theo mỗi lần user mở chi tiết run của mình, không có giá trị kiểm soát |

**Mặc định: A.**

## Câu hỏi kỹ thuật — tự quyết theo mặc định (backend-lead có thể đổi ở PLAN, ghi lý do)
| # | Câu hỏi | Mặc định | Nguồn |
|---|---|---|---|
| Q-K1 | Admin gọi `/agent-grants` qua admin-api (proxy) hay thẳng Hub? | **Thẳng Hub** bằng JWT của admin đang đăng nhập — BA-A §8 ("Admin UI gọi sang `hub/agent-grants` bằng JWT của tenant admin"), BA-H §2, §6.8, §9.1, architecture §2. admin-api hiện không gọi Hub; không thêm proxy | BA, code |
| Q-K2 | CORS | `HUB_CORS_ORIGINS` thêm origin admin-web (dev `http://localhost:3000`); `.env.example` + `docs/guides/hub-dev.md` | `config/env.ts` |
| Q-K3 | `member` gọi `/agent-grants*` | 403 `FORBIDDEN` (không phải tài nguyên theo tenant; khớp Admin API). 404 chỉ dùng cho tenant/tài nguyên khác (BR-14) | BA-A `API_ERRORS` |
| Q-K4 | Dạng DELETE | Query `?agent_id&subject_type&subject_id` (như M3 `GrantDeleteQuery`), idempotent 204; không thêm `/:id` | M3 |
| Q-K5 | Batch nhiều agent một lần | Không ở H3b (số agent/tenant nhỏ); POST một grant/lần. Admin cần batch → CR sau | — |
| Q-K6 | RLS cho `agent_grants` | Không thêm (bảng cấu hình, cache nạp toàn bộ bằng một role); cách ly ở repo + test chéo (R03). Migration chỉ thêm `GRANT INSERT, DELETE ON hub.agent_grants` cho role Hub. Reviewer Opus kiểm mọi câu | `0000` |
| Q-K7 | NOTIFY trong hay sau transaction | **Trong** transaction (`pg_notify`, giao khi commit) như `seed.repo.ts`; rollback/retry 40P01 không gửi — khác Admin M3 (sau commit) nhưng tương đương về đúng/sai | `seed.repo.ts`, TECH-DEBT #13 |
| Q-K8 | Grant mồ côi (group/user bị Admin xoá) | Lọc bằng join `admin.groups`/`admin.users` (hub_ro) ở R11/R13; không xoá tự động; ghi TECH-DEBT dọn định kỳ | TECH-DEBT #15 |
| Q-K9 | Agent tắt / runtime chưa chạy được | Vẫn cấp được; effective trả `agent_disabled`/`runtime_unavailable` | M3-R07 |
| Q-K10 | Ghi `view_trace` lỗi | Fail-closed: 500, không trả trace (R19) | HUB-FR-87 |
| Q-K11 | Vế Hub AC-A03/A10/A11 phần **command** (đầu vào M5, CR-015) | qc thêm test int trên code H2a (AC-13), không code mới; đỏ → TECH-DEBT, không chặn H3b | ROADMAP M5 |
| Q-K12 | Contract đặt ở đâu | Gói con mới `@ai/contracts/hub-admin` (không động `chat`); backend-lead chốt tên | H2a Q3 |
| Q-K13 | Kiểu Drizzle `agentGrants` đang ở `hub-readonly.ts` (stub Admin đọc) | Giữ export cho Admin; Hub dùng cùng định nghĩa để ghi (không khai trùng) — backend-lead chốt | `hub-readonly.ts` |
| Q-K14 | Smoke thật | Không cần (`fake-cli` + mock Dify đủ); I2 chỉ chạy Hub dev + `curl` 3 endpoint với JWT dev | U2 |

## Quyết định trong lúc làm
PLAN (backend-lead, 2026-10-06) — chính xác hoá spec theo Luật 2 (spec → BA → ADR → CONVENTIONS → code hiện có → đơn giản nhất). Chi tiết: `plan.md`, `plan-db.md`. Q-U1…Q-U4 = A (U6); Q-K1…Q-K14 = mặc định, không đổi.

| # | Quyết định | Nguồn / lý do |
|---|---|---|
| PL1 | Contract ở `@ai/contracts/hub-admin` (Q-K12 chốt tên); `HUB_ADMIN_ERRORS` riêng, **không** thêm vào `CHAT_API_ERRORS` | test khoá C1 "đúng 6 mã"; R21 |
| PL2 | **Bổ sung R22**: ngoài `INSERT, DELETE agent_grants` còn cần `GRANT UPDATE (hub_config_version) ON hub.config_meta TO hub_rw` — `hub_rw` hiện chỉ SELECT `config_meta` (`0000` §GRANT) nên không bump được (R08); quyền **một cột**, `FOR UPDATE` dùng được. Reviewer/Gate xem lại (mở quyền DB) | `0000_hub_core.sql:455`; R08 |
| PL3 | Thứ tự transaction ghi: `LOCK_META` FOR UPDATE **trước** → ghi grant → (có đổi) bump → audit → NOTIFY; trùng/không có hàng ⇒ commit trống. Không bump trước rồi mới biết trùng (sẽ phải rollback) và không ghi grant trước rồi mới khoá `config_meta` (ngược chiều `seed` ⇒ deadlock seed ∥ POST) | R06, R08; `seed.repo.ts` khoá `config_meta` đầu |
| PL4 | `lib/http.ts parseQuery` bỏ `tenant_id`/`user_id` (H1-R03) ⇒ thêm `parseAdminQuery` chỉ cho `/agent-grants*`; `parseQuery` giữ nguyên | code hiện có; HUB-BR-14 kênh chat |
| PL5 | `GET /agent-grants` đọc **DB** (thấy ngay sau POST); effective đọc **cache** (R12 "ảnh cache hiện tại", trả `hub_config_version` để Admin biết độ trễ ≤ 5 s) | R11, R12, R15 |
| PL6 | `hub.audit_log`: `tenant_id` NOT NULL (mọi hành động H3b có tenant), `actor_role` thêm so với `admin.audit_log`, không RLS, không GRANT `admin_rw` (Admin đọc = CR-impact, Q-U3) | R16, Q-U3 |
| PL7 | Thêm index `usage_logs_run_idx (run_id) WHERE run_id IS NOT NULL` — trace đọc usage theo run, bảng chỉ có index `(tenant_id, at)`. Prod lớn: tạo `CONCURRENTLY` trước (PRODUCTION-NOTES, I3) | CONVENTIONS §6 "query mới có index" |
| PL8 | Member bị 403 **trước** parse body/query (middleware `requireAdminRole`); sau đó mới đến thứ tự R04 | R01 "không đọc DB" |
| PL9 | Trace che `detail` bằng `redactTraceDetail` (khoá/giá trị nhạy cảm, sâu > 6, > 16 KiB); không trả `jobs.payload/result/token_hash/error_message` | R18; nguồn ghi đã che (`maskInputs`, upstream Dify) — lưới thứ hai |
| PL10 | Tiêm lỗi ghi qua `AppDeps.hubAudit?: HubAuditWriter` (một điểm cho AC-04 "lỗi giữa transaction" và AC-11) | mẫu `ConfigWriteOpts.beforeBump` M3 |
| PL11 | Trace của platform_admin: audit ghi **ngay sau** khi thấy run, trước khi đọc steps/jobs/usage — run không có ⇒ 404 + 0 audit | R17(b), R19, AC-H08 |
| PL12 | `NOT_ENTITLED.details.agent_ids` luôn đúng 1 phần tử (POST một grant — Q-K5); `INVALID_REFERENCE.details = {field}` | M3 hình lỗi; Q-K5 |
| PL13 | POST trùng trả `hub_config_version` hiện tại (đọc khi khoá), không bump | R06 |
| PL14 | CORS không đổi code (`cors({origin: HUB_CORS_ORIGINS})` đã danh sách trắng); chỉ `.env.example` + `hub-dev.md` | R23, Q-K2 |
| PL15 | `redactTraceDetail(detail, view)`: view `own` (chủ run) bỏ khoá gốc `message`, `upstream` của `detail` (theo H1 P11/R26: message thô Runtime không ra client); `platform` giữ nguyên (HUB-BR-02). "Sâu > 6" tính gốc = mức 1; 16 KiB = 16 384 byte UTF-8 sau khi che | readiness N1, G5 |
| PL16 | `SENSITIVE_KEY_RE` dùng `token(?!s)`: giữ `input_tokens`/`output_tokens`/`extra_tokens`; che `token`, `access_token`, `token_hash` | readiness G4 |
| PL17 | `HubExtra` (H1) không có `hubAudit`: qc tự bọc kiểu rộng hơn (`Omit<HubExtra,"signal"> & Pick<AppDeps,"hubAudit">`) cho tiêm lỗi; `startHubX` trải `...extra` vào `deps` | readiness N7 |
| B1 | (BUILD D1) `schema/hub.ts` thêm hằng `HUB_AUDIT_ACTION_VALUES`/`HUB_AUDIT_ENTITY_VALUES`/`HUB_AUDIT_ACTOR_ROLE_VALUES` (khớp 3 CHECK của 0009) làm enum Drizzle cho `hubAuditLog`; export qua `@ai/db/schema/hub` như các bảng Hub khác, không qua `index.ts` | mẫu `ATTACHMENT_ORIGIN_VALUES` H2c |
| B2 | (BUILD D1) `packages/db/src/migrate-hub.int.test.ts` (test backend, không khoá) thêm `audit_log` vào `HUB_TABLES` (21 → 22 bảng) — bảng mới của 0009 | mẫu D1 H2c (`attachments`) |
| B3 | (BUILD D1) Test D1 kiểm "không hơn" bằng ACL nguyên tập (`aclexplode` relacl + attacl của `audit_log`/`agent_grants`/`config_meta`, trừ owner) thay vì từng `has_table_privilege` | R22, PL2, PL6 |
| B4 | (BUILD C1) `hub-admin` lấy mẫu key agent từ `AGENT_KEY_PATTERN` của `../common` (cùng regex `hub/common`), **không** import `../hub` — subpath chạy ở trình duyệt Admin, như `chat/agents.ts`; tự khai `HubAgentRefSchema` (name `{vi,en}` 1–100 cả hai) | plan §2; mẫu `chat/agents.ts` |
| B5 | (BUILD C1) `index.ts` re-export thêm `ErrorResponseSchema`, `GrantSubjectSchema`, `GroupRefSchema` (như `hub-internal`); `usage_total` = `StepUsage` với `model: z.null()`; hằng `AGENT_GRANTS_AGENTS_MAX = 200`, `GRANT_SUBJECT_TYPES`, `HubConfigVersionSchema`, `HUB_ADMIN_ERROR_CODES` | plan §2.2–§2.4 |
| B6 | (BUILD B2) Thân `trace.rules.ts` (`traceAccess`, `redactTraceDetail`, `stepMs`) làm luôn ở B2 thay vì B5 (điều phối giao; QW-R 41/41 một lượt) — B5 chỉ còn repo/service/routes + mount. `redactTraceDetail`: mảng gốc ⇒ `{items}` rồi mới tính mức (gốc = 1); khoá nhạy cảm ⇒ MASK cả khi giá trị là object; giá trị chuỗi mới so `SENSITIVE_VALUE_RE` | PL15, plan §4.3 |
| B7 | (BUILD B2) `effectiveAgents` tự dựng chỉ mục entitlement/grant của T (không gọi `visibleAgents`) vì cần cả agent không thấy + `reasons`; điều kiện giống hệt `visibleAgents`/`accessInput` (R12, test chéo R26 xanh). `reasons` khử trùng theo (agent, subject) | plan §4.2 |
| B8 | (BUILD B1) `dbHubAudit` ghi bằng SQL thô `tx.execute` (jsonb `JSON.stringify(...)::jsonb`, tham số ép kiểu) như plan-db §3, không qua `tx.insert(hubAuditLog)`; `HubAuditRow` là `type` (không `interface`) để gán được vào `AuditRowLike` của `_h3b.ts`; `entity_name` cắt ≤ 200 code point trong writer + helper `grantEntityName(agentKey, subjectKey)` (`→` U+2192) cho B3 | plan-db §3; CHECK 0009; test-plan-log A21 |
| B9 | (BUILD B1) `requireAdminRole` vắng `c.var.user` (gắn trước `requireAuth`) ⇒ 401 `AUTH_EXPIRED` (fail-closed), role ngoài `{tenant_admin, platform_admin}` ⇒ 403 `FORBIDDEN`; export thêm `isAdminRole` | R01, PL8; `auth.middleware.ts` fail-closed |
| B10 | (BUILD B1) Trùng bump/NOTIFY seed ↔ `lib/hub-config-write.ts` ghi TECH-DEBT **73** (K13); `lockHubConfig`/`bumpHubConfig` trả `Number(v)` (driver có thể trả chuỗi) | plan §9 K13, P5 |
