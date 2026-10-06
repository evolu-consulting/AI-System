# Test plan · H3b-agent-grants · phụ lục ca R, A, K, M (qc)

Phụ lục của [`test-plan.md`](test-plan.md). Chữ ký: `plan.md` §4.1 (`targetTenant`, `grantProblem`), §4.2 (`effectiveAgents`), §4.3 (`traceAccess`, `redactTraceDetail`, `stepMs`, `SENSITIVE_*_RE`, `MASK`); contract §2; endpoint × lỗi §3; SQL/audit `plan-db.md` §2–§5. Dữ liệu + helper: test-plan §2.1. `S0 = stateOf()` trước ca; "0 ghi" = `stateOf()` sau ≡ `S0` ở **cả** `acme` và `beta` + không NOTIFY (sentinel).

## 1. R · hàm thuần + contract (`tests/acceptance/H3b/rules/`) — QW-R
### 1.1 `target-tenant.test.ts` · H3b-R01, R02 · AC-01 · `ADM-FR-37`
`tid = acme`, `q ∈ {undefined, acme, beta}`.

| ID | Dữ liệu | Kỳ vọng |
|---|---|---|
| R01 | `member` × 3 giá trị `q` | `{ok:false, code:"FORBIDDEN"}` (cả 3) |
| R02 | `tenant_admin`, `q = undefined` · `q = acme` | `{ok:true, tenantId: acme}` |
| R03 | `tenant_admin`, `q = beta` | `{ok:false, code:"NOT_FOUND"}` |
| R04 | `platform_admin`, `q = undefined` | `{ok:false, code:"TENANT_REQUIRED"}` |
| R05 | `platform_admin` (`tid = platform`), `q = acme` · `q = beta` · `q = platform` | `{ok:true, tenantId: q}` |
| R06 | role lạ `"owner"`, `""` × 3 `q` | `FORBIDDEN` |
| R07 | Bảng đủ 5 role × 3 `q` (15 dòng, kỳ vọng viết tay từ R02) | khớp từng dòng; không dòng nào `tenant_admin` ra `tenantId ≠ tid` |

### 1.2 `grant-problem.test.ts` · H3b-R04 · AC-02, AC-03 · `HUB-BR-17`
| ID | `{agent, subjectInTenant}` | Kỳ vọng |
|---|---|---|
| R10 | `agent: null`, subject `true` · `false` | `"AGENT_NOT_FOUND_REF"` (lỗi agent che lỗi subject) |
| R11 | `isOrchestrator: true`, `entitled` `true`/`false`, subject `false` | `"AGENT_NOT_GRANTABLE"` |
| R12 | `isOrchestrator: false, entitled: false`, subject `false` | `"NOT_ENTITLED"` |
| R13 | `false/true`, subject `false` | `"SUBJECT_NOT_FOUND_REF"` |
| R14 | `false/true`, subject `true` | `null` |
| R15 | Đủ 9 tổ hợp (`null` × 2 + 2×2×2) | đúng thứ tự R04; hàm không nhận role (gọi 2 lần cùng input ⇒ cùng kết quả — "P không bỏ qua") |

### 1.3 `effective-agents.test.ts` · H3b-R12–R14 · AC-07 · `HUB-FR-79`
Snapshot dựng bằng kiểu `AccessSnapshot` (export từ `agent-access.rules.ts`) trong `rules/_snap.ts`; input `Object.freeze` sâu.

| ID | Dữ liệu | Kỳ vọng |
|---|---|---|
| R20 | Phạm vi: `hoadon` ent. `T` không grant · `cu` ent. thu hồi + grant group · `khodu` ent. + grant chỉ ở `beta` · Orchestrator mặc định + tenant (có ent. + grant `T`) · `chua` | có `hoadon`, `cu`; **không** có `khodu`, Orchestrator, `chua` |
| R21 | 5 agent key lộn xộn | sắp theo `key` |
| R22 | user có grant user + group `g1`, `g2` (thuộc `groupIds`) + grant group `g3` (không thuộc) + grant `beta` cùng `subject = user.id` | `reasons` (như tập) = `{grant_user, grant_group g1, grant_group g2}`; không `g3`, không grant `beta` |
| R23 | Mọi điều kiện xấu cùng lúc | `missing` = `["user_inactive","tenant_locked","agent_disabled","runtime_unavailable","no_entitlement","no_grant"]` đúng thứ tự |
| R24 | Ma trận AC-07: agent {bật, tắt} × ent. {có, thu hồi} × grant {user, group, không} × runtime {chạy được, không} × user {active, inactive} × tenant {active, `tenantActive=false`, `lockedByTenant=true`} = 144 dòng; kỳ vọng tính bằng **oracle viết tay trong test** từ bảng R14 | `visible`, `reasons`, `missing` khớp từng dòng |
| R25 | 144 dòng R24 | `visible ⇔ missing.length = 0` |
| R26 | Dòng R24 có user active ∧ tenant active | `{agentId | visible}` ≡ `{x.id | visibleAgents(accessInput(snapshot, {tenantId, userId, groupIds}))}` (bất biến R12) |
| R27 | ent. thu hồi + grant group | `visible:false`, `reasons:[grant_group]`, `missing:["no_entitlement"]` (AC-A11) |
| R28 | user inactive + grant | `reasons` vẫn có `grant_user`; `missing` có `user_inactive` (R05) |
| R29 | Input đóng băng | không ném; input không đổi |

### 1.4 `trace-rules.test.ts` · H3b-R17, R18 · AC-08…10 · `HUB-FR-52`, `HUB-FR-87`
| ID | Gọi | Kỳ vọng |
|---|---|---|
| R40 | `traceAccess({role}, true)` × 3 role | `"own"` (cả platform_admin — Q-U4) |
| R41 | `traceAccess({role}, false)`: platform_admin · tenant_admin · member · `"owner"` | `"platform"` · `"not_found"` · `"not_found"` · `"not_found"` (Q-U2) |
| R42 | khoá: `api_key`, `apiKey`, `client_secret`, `access_token`, `password`, `passwd`, `Authorization`, `Cookie`, `credentials`, `private_key`, `token`, `token_hash`, `tokenBudget` (G4: regex `token(?!s)`; bỏ `max_tokens`) | giá trị = `MASK`; khoá giữ nguyên |
| R43 | giá trị: `"Bearer abc.def"`, `"app-"+16 ký tự`, `"sk-"+16`, `"-----BEGIN RSA PRIVATE KEY-----…"` ở mọi mức, trong mảng | `MASK` |
| R44 | không nhạy cảm: `{label:"x", model:"haiku", note:"app-short", word:"bearer"}` · `{input_tokens:5, output_tokens:7, extra_tokens:3, max_tokens:100}` (G4: `token(?!s)` không khớp `*_tokens`) | giữ nguyên, deep-equal (số token giữ số, không `MASK`) |
| R45 | độ sâu (G5): giá trị mức 6 · mức 7 | giữ · `MASK` |
| R46 | kích thước (G5): JSON sau che 16 384 byte · 16 385 byte | giữ · `{truncated:true}` |
| R47 | `null`, `undefined`, `42`, `"s"` · mảng gốc `[{"token":"x"}]` · input object | `null` · `{items:[{token:MASK}]}` · input không bị sửa |
| R48 | `stepMs(t, null)` · `(t, t)` · `(t, t+1234)` · `(t, t−5)` | `null` · `0` · `1234` · `0` |
| R49 | `redactTraceDetail(detail, view)` với `detail = {message:"M", upstream:"U", usage:{input_tokens:5}, code:"x"}` (N1/PL15): `"own"` · `"platform"` · `message`/`upstream` lồng ở mức 2 (`own`) | `own`: bỏ hẳn khoá gốc `message`, `upstream`, giữ `usage`/`code` · `platform`: giữ nguyên · khoá lồng không bị bỏ (chỉ khoá gốc); input không bị sửa |

### 1.5 `contracts-h3b.test.ts` · spec §3 · `plan` §2 · R21
| ID | Kiểm | Kỳ vọng |
|---|---|---|
| R60 | `HUB_ADMIN_ERRORS` | đúng 5 khoá, status `{FORBIDDEN:403, TENANT_REQUIRED:400, INVALID_REFERENCE:400, NOT_ENTITLED:409, AGENT_NOT_GRANTABLE:409}` |
| R61 | `CHAT_API_ERRORS` | vẫn 6 khoá; không chứa 5 mã mới (PL1) |
| R62 | `AgentGrantCreateSchema` | body có `tenant_id` · `subject_type:"role"` · `subject_id:"x"` ⇒ lỗi; hợp lệ ⇒ ok |
| R63 | `AgentGrantListQuerySchema` | chỉ `subject_type` hoặc chỉ `subject_id` ⇒ lỗi; cả hai/cả vắng ⇒ ok; khoá lạ ⇒ lỗi |
| R64 | `EffectiveAgentSchema` · `AGENT_MISSING` | `visible:true` + `missing:["no_grant"]` ⇒ lỗi; `AGENT_MISSING` nguyên văn thứ tự R14 |
| R65 | `RunTraceSchema`, `TraceJob` | thêm `payload`/`result`/`token_hash` ⇒ lỗi (strict); `cost_usd:"0.0012"` ok, `"1e-3"` lỗi |
| R66 | `NotEntitledDetailsSchema`, `InvalidReferenceDetailsSchema` | `agent_ids` 0 hoặc 2 phần tử ⇒ lỗi; `field:"tenant_id"` ⇒ lỗi |

## 2. A · int hub-api (`tests/acceptance/H3b/*.int.test.ts`) — QW-A
### 2.1 `role-tenant.int.test.ts` (A01–A14) · R01–R03 · AC-01 · `ADM-FR-37`, `HUB-BR-14`
Endpoint `E` = {GET list, POST, DELETE, GET effective(`lan`)}; mỗi ca chạy trên cả 4.

| ID | Ai · gửi | Kỳ vọng |
|---|---|---|
| A01 | không token · token hết hạn · ký khoá khác (+ `GET /runs/:id/trace`) | 401 `AUTH_EXPIRED`/như H1; 0 ghi |
| A02 | `lan` (member) · hợp lệ · body sai · `?tenant_id=xyz` · `?tenant_id=beta`; A02b JWT ký đúng nhưng `role:"owner"` | A02: 403 `FORBIDDEN` (trước validate — PL8); 0 ghi · A02b: **401 `AUTH_EXPIRED`** (N2: `jwt.ts` từ chối role lạ ⇒ null), 0 ghi |
| A03 | `tadmin` `?tenant_id=beta` (body hợp lệ cho `beta`) | 404 `NOT_FOUND`, ≡ (G1) `?tenant_id=UNKNOWN`; 0 ghi ở `beta` và `acme` |
| A04 | `tadmin` `?tenant_id=acme` | như không gửi (200/201/204) |
| A05 | `padmin` không `tenant_id` | 400 `TENANT_REQUIRED`; 0 ghi |
| A06 | `padmin` `?tenant_id=UNKNOWN` · `?tenant_id=abc` | 404 · 400 `VALIDATION_ERROR` |
| A07 | `padmin` `?tenant_id=beta` POST `khodu` → `ban-hang`; GET `beta`; DELETE | 201 hàng `tenant_id=beta`; audit `tenant_id=beta, actor_role=platform_admin`; GET `acme` không đổi; DELETE 204 |
| A08 | `padmin` `?tenant_id=acme` POST subject `ban-hang` (beta) | 400 `INVALID_REFERENCE {field:"subject_id"}` |
| A09 | `tadmin` POST body có `tenant_id: beta` | 400 `VALIDATION_ERROR`; 0 ghi |
| A10 | `badmin` (beta) DELETE `hoadon/group/ke-toan` (grant `acme` có thật) | 204; hàng `acme` còn; 0 bump/audit/NOTIFY |
| A11 | `tadmin` GET `?subject_type=group&subject_id=<ban-hang>` | 200; mọi `grants:[]`; không id nào của `beta` trong thân |
| A12 | `tadmin` `?tenant_id=beta` + body sai; `padmin` không `tenant_id` + body sai | 400 `VALIDATION_ERROR` cả hai (G2) |
| A13 | query khoá lạ `?foo=1` · `?user_id=<lan>` | 400 `VALIDATION_ERROR` |
| A14 | `padmin` `?tenant_id=platform` GET | 200 `items:[]`, `tenant_id = platform` |

### 2.2 `grants-write.int.test.ts` (A20–A41) · R04–R08 · AC-02, AC-03, AC-04 · `HUB-FR-78`, `HUB-BR-17`
| ID | Thao tác | Kỳ vọng |
|---|---|---|
| A20 | `tadmin` POST `hoadon → group ke-toan` | 201; thân parse `AgentGrantWriteResponseSchema`; `hub_config_version = v0+1`; `grant.subject = {type:"group", group:{id,key:"ke-toan",name}}`; `granted_by = "tadmin"`; DB `granted_by = tadmin.id` |
| A21 | (sau A20) audit | đúng 1 hàng mới: `action=grant, entity=agent_grant, entity_id=grant.id, tenant_id=acme, actor_id=tadmin, actor_username=tadmin, actor_role=tenant_admin, hub_config_version=v0+1, before=null, after={agent_id, agent_key:"hoadon", subject_type:"group", subject_id, subject_key:"ke-toan"}, summary={}, entity_name="hoadon → ke-toan"` |
| A22 | (A20) NOTIFY | đúng 1 thông điệp từ mốc, payload `{v: HUB_CONTRACT_VERSION, version: v0+1}`, ≤ 1 s (nới 3 s) sau 2xx |
| A23 | POST lại y hệt | 200, cùng `grant.id`, `granted_by`/`granted_at` của hàng gốc (G13), `hub_config_version` = hiện tại; 0 bump/audit/NOTIFY (sentinel) |
| A24 | POST `hoadon → user hoa` (U5: chỉ API) | 201; `subject = {type:"user", user:{id, username:"hoa", display_name}}` |
| A25 | POST `→ user nghi` (inactive) · `tatt` (tắt) · `cli-x` (runtime) | 201 cả ba (R05) |
| A26 | `agent_id = UNKNOWN` (subject hợp lệ · subject `beta`) | 400 `INVALID_REFERENCE {field:"agent_id"}` cả hai |
| A27 | Orchestrator mặc định · tenant `acme` · tenant `beta` (cả hai có ent. `acme`) | 409 `AGENT_NOT_GRANTABLE`, không `details` |
| A28 | `chua` (không ent.) · `cu` (thu hồi) — `tadmin` và `padmin ?tenant_id=acme` · `khodu` (ent. chỉ `beta`) | 409 `NOT_ENTITLED {agent_ids:[id]}` |
| A29 | Orchestrator không ent. `acme` | 409 `AGENT_NOT_GRANTABLE` (thứ tự) |
| A30 | subject: group `ban-hang` · user `an` · `UNKNOWN` · id user `lan` với `subject_type:"group"` | 400 `INVALID_REFERENCE {field:"subject_id"}`; 4 thân ≡ nhau (G1) |
| A31 | `chua` + subject `beta` | 409 `NOT_ENTITLED` (agent trước subject) |
| A32 | thiếu `agent_id` · `subject_type:"role"` · `subject_id:"x"` · JSON hỏng | 400 `VALIDATION_ERROR` |
| A33 | Mọi ca A26–A32 | 0 ghi (bảng, version, audit, NOTIFY) |
| A34 | DELETE grant A20 | 204 thân rỗng; hàng mất; `v+1`; audit `revoke`: `before = {…after của grant, granted_by, granted_at}`, `after = null`, `entity_id` = id cũ; 1 NOTIFY |
| A35 | DELETE lại | 204; 0 ghi |
| A36 | DELETE grant có sẵn (owner) của `cu` (ent. thu hồi) · của Orchestrator (chèn owner) | 204 + 1 bump/audit/NOTIFY mỗi cái (không kiểm ent./Orchestrator khi thu hồi) |
| A37 | DELETE thiếu `subject_id` · `agent_id` không uuid | 400 `VALIDATION_ERROR` |
| A38 | `hubAudit = failingAudit(["grant"])`, POST mới | 500 `INTERNAL_ERROR` (G3); 0 hàng grant, version không đổi, 0 audit, 0 NOTIFY; rồi Hub thường POST ⇒ 201 (không kẹt khoá) |
| A39 | `failingAudit(["revoke"])`, DELETE có hàng | 500; hàng còn; version không đổi; 0 audit; 0 NOTIFY |
| A40 | grant do `padmin` tạo; `tadmin` GET | `granted_by = "padmin"` (QP2) |
| A41 | grant từ seed (`granted_by` NULL) | GET + POST trùng trả `granted_by = null` |

### 2.3 `grants-concurrency.int.test.ts` (A45–A51) · R06, R08 · AC-05 · plan §6
| ID | Thao tác | Kỳ vọng |
|---|---|---|
| A45 | ×10 vòng: `holdConfigMeta` → 2 POST cùng khoá → `lockWaiters = 2` → `release` (xoá hàng owner giữa vòng) | status `{201, 200}`; cùng `id`; 1 hàng; `v+1` đúng 1; 1 audit; 1 NOTIFY mỗi vòng |
| A46 | ×10: rào như A45, POST ∥ DELETE cùng khoá | không 500; `pgDeadlocks` Δ = 0; hàng tồn tại ⇔ thao tác commit sau là POST; Δversion = Δaudit = số NOTIFY = số thao tác có đổi |
| A47 | ×10: POST (khoá khác nhau) ∥ seed thật (YAML có `hoadon → kho`) | cả hai xong; `pgDeadlocks` Δ = 0; grant API còn sau seed (G8) |
| A48 | POST ∥ `hubConfigChange` owner | cả hai xong; hai version khác nhau liên tiếp |
| A49 | `holdConfigMeta`, POST | backend POST chờ khoá hàng `config_meta`; `pg_locks` backend đó **không** có `RowExclusiveLock` trên `hub.agent_grants`; `release` ⇒ 201 |
| A50 | owner `LOCK TABLE hub.audit_log IN SHARE ROW EXCLUSIVE MODE`, POST | backend POST chờ `audit_log`, đang giữ khoá hàng `config_meta` + `RowExclusiveLock` `agent_grants`; nhả ⇒ 201 |
| A51 | 2 POST khác khoá song song | 201 cả hai; version `v+1`, `v+2` (khác nhau); 2 audit; 2 NOTIFY |

### 2.4 `grants-list.int.test.ts` (A55–A62) · R11 · AC-06
| ID | Thao tác | Kỳ vọng |
|---|---|---|
| A55 | `tadmin` GET | parse `AgentGrantListResponseSchema`; `items` = {`cli-x`, `hoadon`, `tatt`} sắp `key`; không Orchestrator, `cu`, `khodu`, `chua`; `tatt.enabled=false`, `cli-x.runnable=false` |
| A56 | grant `beta` trên cùng agent (owner) · `badmin` GET | `acme` không thấy grant `beta`; `beta` không thấy grant `acme` |
| A57 | `?subject_type=group&subject_id=<ke-toan>` · chỉ `subject_type` | chỉ grant `ke-toan` · 400 `VALIDATION_ERROR` |
| A58 | grant `kho` rồi owner xoá group `kho` | không xuất hiện; hàng DB còn (Q-K8) |
| A59 | `cu` (thu hồi) có grant | không trong `items` |
| A60 | POST rồi GET ngay (không chờ) | thấy grant mới (đọc DB, PL5) |
| A61 | — | `hub_config_version` = `config_meta` hiện tại |
| A62 | owner chèn 201 agent có ent. `acme` · 501 grant user trên `hoadon` | `items.length = 200`, `truncated:true` · `grants.length = 500`, `grants_total = 501` |

### 2.5 `effective.int.test.ts` (A65–A72) · R12–R15 · AC-07 · `HUB-FR-79`
| ID | Thao tác | Kỳ vọng |
|---|---|---|
| A65 | grant `hoadon → ke-toan` + `→ user lan`; effective `lan` | parse schema; `hoadon` `visible`, `reasons = [grant_user, grant_group{group:{id,key:"ke-toan",name}}]`, `missing:[]` |
| A66 | Đại diện ma trận: `tatt` (`agent_disabled`), `cli-x` (`runtime_unavailable`), `nghi` (`user_inactive`), `khoa` (`tenant_locked`), `gam` qua `padmin ?tenant_id=gamma` (`tenant_locked`; N3: fixture `gamma` đang hoạt động ⇒ ca tự `UPDATE admin.tenants SET active=false` bằng owner + `adminChange` (NOTIFY), chờ cache, gọi, **trả lại `active=true` trong `finally`**), `cu` (`no_entitlement` + reasons), không grant (`no_grant`) | `missing` đúng thứ tự R14 |
| A67 | cùng version: effective `lan` vs `GET /agents` của `lan` | tập `visible` ≡ tập key `GET /agents` |
| A68 | `tadmin`: user `an` · `"abc"` · `UNKNOWN`; `padmin ?tenant_id=beta` user `lan`; `padmin ?tenant_id=acme` user `lan` | 404 ×4 (≡ nhau) · 200 |
| A69 | — | không `khodu`, `chua`, Orchestrator |
| A70 | — | 0 audit, version không đổi |
| A71 | POST grant mới, chờ | ≤ 10 s effective có `hub_config_version ≥` version POST và reason mới (F4) |
| A72 | owner xoá group `ke-toan` không NOTIFY, gọi effective | 200, `reasons` bỏ group vắng, không 500 |

### 2.6 `propagation.int.test.ts` (A80–A86) · R09, R10 · AC-H09, AC-A11 · 2 instance
| ID | Thao tác | Kỳ vọng |
|---|---|---|
| A80 | trước grant | `lan` ở cả 2 instance: `GET /agents` không `hoadon`; lượt gửi trên instance 2 ⇒ prompt Orchestrator (`block()`) không `hoadon` |
| A81 | `tadmin` POST trên instance 1 | ≤ 5 s (nới 10 s, in ms) instance 2 `GET /agents` có `hoadon`; lượt gửi kế có `hoadon` |
| A82 | run đang chạy (ScriptRuntime chặn) lúc grant | `runs.config_version` của run = cũ (HUB-BR-06) |
| A83 | DELETE | ≤ 5 s biến khỏi cả 2 instance |
| A84 | thu hồi ent. `hoadon/acme` (owner + NOTIFY) | ≤ 5 s mất khỏi `GET /agents`; hàng grant còn; effective `missing:["no_entitlement"]`, `reasons:[grant_group ke-toan]`; `GET /agent-grants` không còn `hoadon` |
| A85 | cấp lại ent. | ≤ 5 s `hoadon` trở lại, cùng `grant.id`, không POST |
| A86 | POST khi đang thu hồi | 409 `NOT_ENTITLED` |

### 2.7 `trace.int.test.ts` (A90–A102) · R16–R20 · AC-H08, AC-08…11 · `HUB-FR-52`, `HUB-FR-87`
Dữ liệu `insertTraceRun` (owner): `R_lan` (acme/`lan`: step orchestrator + delegate `fake-cli` + workflow mock Dify + tool; 2 job; usage theo step + 1 dòng `step_id` NULL; tin user/answer có `MSG_MARK`), `R_beta` (`an`), `R_tam`, `R_pad` (`padmin`), `R_tad` (`tadmin`). `PLANTED` cài vào `run_steps.detail` (`{api_key:"app-…", headers:{Authorization:"Bearer …"}, note:"sk-…"}`) và `jobs.payload/result/token_hash/error_message`.

| ID | Ai · run | Kỳ vọng |
|---|---|---|
| A90 | `lan` · `R_lan`; `tadmin` · `R_tad` | 200 parse `RunTraceSchema`; steps theo `seq`, `ms`; jobs; usage gắn step; `usage_total` gồm dòng NULL; `messages.user/answer`; 0 audit |
| A91 | `lan`, `tadmin`, `badmin`→`R_lan` · `R_beta` | 404; ≡ (G1) id `UNKNOWN` và id `"abc"`; 0 audit (AC-H08) |
| A92 | `tadmin` · `R_lan`; `hoa` · `R_lan` | 404 ≡; 0 audit (Q-U2) |
| A93 | `padmin` · `R_lan` ×2 | 200 đầy đủ ×2; đúng 2 hàng `view_trace`: `tenant_id=acme, actor_id=padmin, actor_role=platform_admin, entity=run, entity_id=R_lan, entity_name='', hub_config_version=null, before=after=null, summary={run_user_id: lan, run_status}` |
| A94 | `padmin` · `R_beta` | 200; audit `tenant_id = beta` |
| A95 | `padmin` · `R_pad` | 200; 0 audit (Q-U4) |
| A96 | `padmin` · `UNKNOWN` | 404; 0 audit (PL11) |
| A97 | mọi thân 200 (A90, A93) + mọi hàng audit | không chứa chuỗi `PLANTED`; khoá nhạy cảm ⇒ `"••••"`; jobs không khoá `payload/result/token_hash/error_message`; audit không chứa `MSG_MARK`/`PLANTED` |
| A97b | `insertTraceRun` `R_lan` có step lỗi `detail = {message:"MSG_ERR", upstream:"UP_ERR", usage:{input_tokens:5,output_tokens:7}}` (N1/PL15; H1-R26). `lan` · `R_lan`; `padmin` · `R_lan` | `lan`: không `detail.message`/`detail.upstream` (không chứa `MSG_ERR`/`UP_ERR`), `usage` giữ số · `padmin`: có `message`/`upstream` nguyên văn (HUB-BR-02) + 1 audit `view_trace`; unit R49 khoá hai view |
| A98 | `failingAudit(["view_trace"])`: `padmin` · `R_lan`; `lan` · `R_lan` | 500 `INTERNAL_ERROR`, thân không có `R_lan`/`MSG_MARK`; 0 audit · 200 (nhánh chủ không audit) |
| A99 | run 201 step, 201 job | 200 step, 200 job, `truncated:true` |
| A100 | owner chèn `jobs`/`usage_logs` cùng `run_id = R_lan` nhưng `tenant_id = beta` | `padmin` và `lan`: không thấy hàng đó, `usage_total` không cộng (K10) |
| A101 | `GET /runs/R_lan` của `lan` | thân parse strict schema chat `Run` (không trường trace — R20) |
| A102 | usage có `cost_usd` NULL một dòng | `cost_usd: null` ở step đó; số khác dạng `DecimalString` |

### 2.8 `cors.int.test.ts` (A110–A113) · R23 · AC-12
| ID | Thao tác | Kỳ vọng |
|---|---|---|
| A110 | `corsOrigins=[:3100, :3000]`; `OPTIONS /agent-grants` Origin `http://localhost:3000`, `Access-Control-Request-Method: POST`, headers `authorization, content-type` | 2xx; `Access-Control-Allow-Origin = http://localhost:3000` |
| A111 | như trên, `DELETE`; `OPTIONS /runs/x/trace` `GET` | cho phép |
| A112 | Origin `http://evil.example` | không `Access-Control-Allow-Origin` |
| A113 | `corsOrigins=[:3100]` (mặc định) · mọi trường hợp | `:3000` không có ACAO; không bao giờ `*` |

### 2.9 `db-grants.int.test.ts` (A120–A126) · R16, R22, PL2 · K9 (vế acceptance, độc lập D1)
| ID | Kiểm (role `hub_api` trừ khi ghi owner) | Kỳ vọng |
|---|---|---|
| A120 | `agent_grants`: INSERT · DELETE · UPDATE `granted_by` · TRUNCATE | ok · ok · 42501 · 42501 |
| A121 | `config_meta`: `UPDATE SET hub_config_version = …` · UPDATE **từng** cột khác (liệt kê `information_schema.columns`) · INSERT · DELETE · `SELECT … FOR UPDATE` | ok · 42501 mỗi cột · 42501 · 42501 · ok |
| A122 | Danh sách trắng (G11) qua `has_table_privilege`/`has_column_privilege` cho `hub_rw` | đúng: `agent_grants` {SELECT, INSERT, DELETE}; `config_meta` {SELECT} + UPDATE chỉ `hub_config_version`; `audit_log` {SELECT, INSERT}; `agent_entitlements`/`agents`/`orchestrator_settings` không INSERT/UPDATE/DELETE; `admin_rw`, `agent_runtime` không quyền `hub.audit_log`; `admin_rw` vẫn chỉ SELECT `agent_grants` |
| A123 | `audit_log` UPDATE/DELETE/TRUNCATE: `hub_api` · owner | 42501 · P0001 |
| A124 | CHECK `action='x'`, `entity='x'`, `actor_role='x'`, `entity_name` 201 ký tự; `hub_api` INSERT hợp lệ | 23514 · ok (`seq` tự sinh) |
| A125 | cột `hub.agent_grants` | ≡ danh sách `0000` (R22) |
| A126 | chạy lại migration Hub | không lỗi; `usage_logs_run_idx` có |

### 2.10 `H3b-cmd/command-m5.int.test.ts` (A130–A134) · AC-13 · Q-K11 · đỏ ⇒ TECH-DEBT, ngoài `done:h3b` (G7)
Code H2a, không code mới; đổi `admin.*` bằng owner + NOTIFY `config_changed` (helper `adminChange` H1).

| ID | Thao tác | Kỳ vọng |
|---|---|---|
| A130 | cấp feature cho group `ke-toan` | ≤ 5 s menu `GET /commands` của `lan` có lệnh |
| A131 | kill switch feature | ≤ 5 s mất khỏi menu |
| A132 | `an` (không được cấp) gõ lệnh | `CMD_NOT_FOUND` |
| A133 | thu hồi entitlement feature `acme` | ≤ 5 s mất; grant feature còn |
| A134 | cấp lại entitlement | ≤ 5 s hiệu lực lại, không cấp lại grant |

## 3. K · hồi quy khoá (chạy lại nguyên văn, không sửa) — AC-14, R20–R22
| ID | Test | Lý do |
|---|---|---|
| K01 | `packages/contracts/src/chat/{agents,attachments}.test.ts` (`CHAT_API_ERRORS` đúng 6 mã) — "C1" | PL1 |
| K02 | `bun run test:contract:chat` (41) | R21 |
| K03 | H1 `runs.int` (`GET /runs/:id` không đổi), `isolation.int`, `auth.int` (A7: `tenant_id` query bị bỏ ở chat — PL4/K8) | R20, P8 |
| K04 | H1 `concurrency.int` (A37 lock-order), `seed.int` | thứ tự khoá, bump/NOTIFY |
| K05 | H1 `rules/{agent-access,contracts-hub}.test.ts` | `visibleAgents` không đổi |
| K06 | H1 `db.int` (A48–A51) | migration |
| K07 | H2a `seed.int`, `commands.int`, `db.int` | seed/command |
| K08 | H2b `agents-menu.int`, `seed-tenant.int`, `orchestrator-tenant.int`, `db.int` | menu agent, Orchestrator tenant |
| K09 | H2c toàn bộ int | — |
| K10 | H3a toàn bộ (`done:h3a`) | — |
| K11 | M3 `hub-view.int` (`admin_rw` đọc `agent_grants`), `db-rls.int` | R22 |
| K12 | `ADM-NFR-06/migrate.int` | migration chung |
| K13 | M4 usage int | `usage_logs_run_idx` không đổi kết quả |
| K14 | admin-api `lib/lock-order.int` | không chạm nhưng cùng DB |
| K15 | `bun run test:lock:verify` | khoá |
| K16 | `bun run trace --check` | truy vết |

## 4. M · thủ công (I2, Q-K14)
| ID | Việc |
|---|---|
| M01 | Hub dev + `curl` GET/POST/DELETE grant, effective, trace với JWT dev 3 role: member 403, `tenant_admin ?tenant_id=<khác>` 404, `platform_admin` thiếu/có `?tenant_id`; preflight Origin `:3000`. Ghi `sd` "Kết luận" |
