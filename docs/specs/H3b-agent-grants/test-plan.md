# Test plan · H3b-agent-grants (qc)

Chế độ **TEST-PLAN** (task QW-T) · 2026-10-06. Chưa có file test, chưa khoá; viết + "đỏ đúng lý do" ở QW (sau Gate, D1/C1/B0/MK), khoá Q2. Bảng ca chi tiết (R, A, K, M) → [`test-plan-cases.md`](test-plan-cases.md).
"Đúng" = spec §2 (H3b-R01…R23), [`spec-ac.md`](spec-ac.md) (AC-H08 vế trace, AC-H09 vế grant, AC-A11 vế Hub, HUB-H3b-AC-01…14); contract + endpoint × lỗi + chữ ký luật thuần `plan.md` §2–§4; luồng/khoá `plan.md` §5–§6; migration + SQL + hàng audit `plan-db.md` §1–§5; quyết định U1–U6, Q-K1…Q-K14, PL1–PL14 (`spec-decisions.md`), QP1–QP2 (`plan.md` §10). Hộp đen: không đọc code implementation.

## 1. Quy ước
Như H3a §1 (tên test, chờ theo điều kiện không `sleep`, cấm `skip/only/todo`, id cố định không ngẫu nhiên, ca tự dọn), thêm:

| Mục | Quy ước H3b |
|---|---|
| Tên test | `"<mã BA> · <ID> · mô tả [H3b-Rxx · HUB-H3b-AC-yy]"` |
| Mã đầu tên | grant/thu hồi, NOTIFY, audit grant → `HUB-FR-78`; effective → `HUB-FR-79`; trace nội dung → `HUB-FR-52`; `view_trace`/fail-closed → `HUB-FR-87`; vế Admin của endpoint grant (role, tenant đích) → `ADM-FR-37`; luật entitlement/Orchestrator → `HUB-BR-17`; 404 chéo tenant → `HUB-BR-14`; AC BA → `AC-H08`/`AC-H09`/`AC-A11` |
| Loại | **R** unit TS hàm thuần + contract · **A** int hub-api (DB/Redis thật, `ScriptRuntime`/`fake-cli` H1, mock Dify H2a) · **K** khoá có sẵn chạy lại nguyên văn · **M** thủ công (I2) |
| Vị trí | R `tests/acceptance/H3b/rules/*.test.ts` · A `tests/acceptance/H3b/*.int.test.ts` · AC-13 (command, không chặn) `tests/acceptance/H3b-cmd/command-m5.int.test.ts` (G7) |
| Role DB | Request luôn qua `hub_api` (thành viên `hub_rw`) của app thật; dựng/kiểm dữ liệu bằng owner (`ownerSql`) |
| Tenant chéo | **Mọi** endpoint có ít nhất một ca chéo tenant (ma trận §3.1). So 404 "giống hệt": `status`, `content-type`, thân JSON bỏ trường `request_id` (G1) |
| "Không xảy ra" | Không chờ treo tường. NOTIFY vắng: phát **sentinel** (`hubConfigChange` owner, NOTIFY có `version` riêng) sau thao tác, chờ sentinel tới rồi khẳng định không có thông điệp nào khác giữa mốc `from` và sentinel (NOTIFY giao theo thứ tự commit). Ghi vắng: so `stateOf()` trước/sau |
| Thời gian | AC ≤ 5 s → chờ tối đa 10 s, ≤ 1 s (NOTIFY sau commit) → 3 s (memory "perf ưu tiên thấp"); in ms thực; vượt AC nhưng < hạn nới ⇒ ghi §5, không đỏ |
| Audit | `hub.audit_log` append-only (trigger chặn cả owner) ⇒ **không dọn được trong file**: đếm theo `seq > mốc đầu ca` + lọc `entity_id`/`actor_id`; DB reset theo file (`prepareDb` xoá schema — DROP không bị trigger chặn) |

## 2. Hạ tầng, fixture
| Mục | Đề xuất | Ai |
|---|---|---|
| DB | DB riêng qc (`bun run db:test:create qc`), migrate tới `0009` qua `prepareDb` H1 | qc |
| Hub | `startHubX` (H1) bọc trong `startHubH3b(k, {hubAudit?})`; `HubExtra` không có `hubAudit` ⇒ qc tự bọc: `type H3bExtra = Omit<HubExtra,"signal"> & Pick<AppDeps,"hubAudit">` trong `_h3b.ts` (`startHubX` trải `...extra` vào `deps`; N7) để tiêm lỗi audit (fail-closed, P12/PL10); hai instance cho AC-H09/A11 | qc |
| Seed ∥ POST | hàm seed thật (`bun run hub:seed` với YAML tạm, owner) — A47 | qc; MK xác nhận đường gọi |
| CORS | `createApp({version, corsOrigins:[…]}, {})` không DB (preflight không chạm DB) — A110–A113 (G9) | qc |

### 2.1 Dữ liệu chung (`tests/acceptance/H3b/_h3b.ts`, id `idGen` dải riêng H3b)
| Thứ | Giá trị |
|---|---|
| Tenant / user (H1 `_fixtures`) | `acme`: `lan` (X, member), `hoa` (member), `tadmin` (A, tenant_admin), `khoa` (locked), `nghi` (inactive), `tam`; `beta`: `an` (member) + **`badmin`** (tenant_admin `beta`, thêm bằng owner); `platform`: `padmin` (P); `gamma` (fixture **đang hoạt động**; ca A66 tự khoá rồi trả lại trong `finally` — N3): `gam` |
| Group (owner `admin.groups`/`group_members`) | `ke-toan` (acme: `lan`, `hoa`), `kho` (acme: `tam`), `ban-hang` (beta: `an`) |
| Agent | `hoadon` (bật, runtime chạy được, entitlement `acme`) · `khodu` (entitlement **chỉ** `beta`) · `tatt` (tắt, ent. `acme`) · `cli-x` (runtime ∉ `RUNNABLE_RUNTIMES`, ent. `acme`) · `cu` (ent. `acme` **đã thu hồi**) · `chua` (không ent. ở đâu) · Orchestrator mặc định (H1 `AG`) + Orchestrator tenant `acme` (H2b `orchAcme`), cả hai được cấp entitlement `acme` để ca "Orchestrator" không bị `NOT_ENTITLED` che |
| Helper | `stateOf(sql)` = `{grants theo tenant (id, khoá), hub_config_version, audit max seq}` · `listenHub(sql)` → `{mark(), since(mark), sentinel()}` · `auditSince(sql, seq, filter)` · `entitle/revokeEnt(sql, agent, tenant)` (bọc `hubConfigChange`) · `holdConfigMeta(sql)` → `release()` (owner tx `SELECT … FOR UPDATE`) · `lockWaiters(sql)` (`pg_stat_activity` `usename='hub_api' ∧ wait_event_type='Lock'`) · `insertTraceRun(sql, {...})` (run + steps + jobs + usage + messages, owner) · `PLANTED` (chuỗi bí mật mẫu) · `failingAudit(actions)` (`HubAuditWriter` ném khi `action ∈ actions`) · `same404(a, b)` |

## 3. Ma trận AC → test
| AC | Ca | Loại |
|---|---|---|
| **AC-H08** (vế trace) | A91 (member + tenant_admin `acme` → run `beta` ≡ id vắng, 0 audit) | A |
| **AC-H09** (vế grant) | A80–A82 (2 instance, LISTEN thật, ≤ 5 s, `GET /agents` + danh sách đưa Orchestrator) | A |
| **AC-A11** (vế Hub, agent) | A84–A86, A59, A66 | A |
| **HUB-H3b-AC-01** (R01/R02) | R01–R07; A01–A13 | R, A |
| **AC-02** (R04 agent) | R10–R15; A26–A29, A31, A33, A86 | R, A |
| **AC-03** (R04 subject) | R10–R15; A08, A30, A33 | R, A |
| **AC-04** (R06–R08 ghi) | A20–A25, A34–A39 | A |
| **AC-05** (đồng thời) | A45–A51 | A |
| **AC-06** (R11 list) | A55–A62 | A |
| **AC-07** (R12–R14 effective) | R20–R29; A65–A72 | R, A |
| **AC-08** (chủ run) | A90 | A |
| **AC-09** (platform_admin + audit) | A93–A96 | A |
| **AC-10** (404 + che) | R42–R46, R49; A92, A97, A97b, A100 | R, A |
| **AC-11** (fail-closed) | A98 | A |
| **AC-12** (CORS) | A110–A113 | A |
| **AC-13** (command M5, không chặn) | A130–A134 (G7) | A |
| **AC-14** (hồi quy) | R60–R61; K01–K16; A120–A126 | R, K, A |

### 3.1 Cách ly tenant — mỗi endpoint × vai (rủi ro cao nhất, K1–K3 spec §10)
| Endpoint | member `acme` | tenant_admin `acme` + `?tenant_id=beta` | tenant_admin `acme`, đối tượng `beta` | tenant_admin `beta` lên dữ liệu `acme` | platform_admin |
|---|---|---|---|---|---|
| `GET /agent-grants` | A02 403 | A03 404 | A11 (lọc subject `beta` ⇒ `grants:[]`), A56 | A56 (không thấy grant `acme`) | A05 thiếu ⇒ 400 · A06 vắng tenant ⇒ 404 · A07 `beta` ⇒ đúng `beta` |
| `POST /agent-grants` | A02 | A03 | A30 subject `beta` ⇒ 400 `subject_id` · A27 Orchestrator tenant khác ⇒ 409 | — | A07, A08 (P cũng không cấp subject chéo), A28 (P không bỏ qua entitlement) |
| `DELETE /agent-grants` | A02 | A03 | — | A10 (204, hàng `acme` còn, 0 ghi) | A05, A07 |
| `GET …/effective/:user_id` | A02 | A03 | A68 (user `beta` ⇒ 404) | A68 | A68 (`tenant_id=beta` + user `acme` ⇒ 404) |
| `GET /runs/:id/trace` | A91, A92 404 | — (không nhận `tenant_id`) | A91 run `beta` ⇒ 404 · A92 run người khác cùng tenant ⇒ 404 | A91 (đối xứng) | A93–A96 (+ audit), A100 (không lẫn hàng tenant khác dù cùng `run_id`) |

### 3.2 Luật → ca (mỗi luật ≥ 1 ca)
| Luật | Ca | Luật | Ca |
|---|---|---|---|
| R01 | R01, R06; A01, A02 | R13 | R20, R21; A69, A84 |
| R02 | R01–R07; A03–A07, A14 | R14 | R22–R28; A65, A66 |
| R03 | A03, A10, A11, A30, A56, A68, A100; review | R15 | A70, A71 |
| R04 | R10–R15; A26–A33 | R16 | A21, A34, A93, A97; A123, A124 |
| R05 | A25; R28 | R17 | R40, R41; A90–A96 |
| R06 | A23, A45, A51 | R18 | R42–R47, R49; A97, A97b, A99, A102 |
| R07 | A34–A36, A10 | R19 | A98 |
| R08 | A20–A22, A38, A39, A49, A50 | R20 | A101; K03 |
| R09 | A80–A83 | R21 | R60, R61; K01, K02, K05 |
| R10 | A84, A85 | R22 | A120–A126; K11, K12 |
| R11 | A55–A62 | R23 | A110–A113 |
| R12 | R26; A67, A68 | PL2 (`hub_rw`) | A120–A122 |

## 4. Trọng tâm rủi ro → cách kiểm
| Rủi ro | Kiểm |
|---|---|
| Chéo tenant (không RLS `agent_grants`, R03) | §3.1 đủ 5 endpoint; mọi ca lỗi kèm `stateOf` trước = sau ở **cả hai** tenant; so 404 giống hệt ca id vắng |
| Role | member 403 **trước** validate (A02: body/query sai vẫn 403 — PL8); `role` lạ (JWT ký đúng, `role:"owner"`) ⇒ **401 `AUTH_EXPIRED`** (A02b, N2; `jwt.ts` từ chối; R06 giữ phòng thủ `FORBIDDEN`) |
| Entitlement chưa thu hồi | A28 (vắng / thu hồi / platform_admin), A84–A86 (thu hồi ⇒ mất ≤ 5 s, grant còn; cấp lại ⇒ về, cùng `id`) |
| Không cấp Orchestrator | A27 mặc định + tenant `acme` + tenant `beta`; A29 thứ tự trước `NOT_ENTITLED`; R20 effective loại Orchestrator |
| Tập hợp | A23 trùng ⇒ 200 cùng `id`, 0 bump/audit/NOTIFY (sentinel); A35 xoá không có ⇒ 204, 0 ghi |
| NOTIFY + version ≤ 5 s | A22 (1 thông điệp, `version` = sau ghi, ≤ 1 s→3 s), A80–A85 (2 instance) |
| Audit trong transaction | A38/A39 tiêm lỗi ⇒ 0 grant, 0 bump, 0 audit, 0 NOTIFY, lần sau vẫn ghi được (không kẹt khoá); A123 append-only |
| Trace | A90 chủ run 0 audit · A93/A94 P + 1 audit/lần · A95 P chủ run 0 audit · A96 id vắng 0 audit · A98 audit lỗi ⇒ 500 không thân trace · A92 tenant_admin ⇒ 404 · A97 quét bí mật · A97b chủ run không thấy `detail.message`/`upstream`, P thấy (N1) |
| Thứ tự khoá `config_meta → agent_grants → audit_log` | A49 (giữ `config_meta` ⇒ POST chờ ở `config_meta`, chưa khoá `agent_grants`), A50 (khoá `audit_log` ⇒ POST đang giữ `config_meta` + `agent_grants`), A46/A47 POST ∥ DELETE / seed: 0 deadlock |
| Quyền `hub_rw` (PL2) | A120–A122: đúng cột `hub_config_version` được UPDATE; mọi cột khác `config_meta` 42501; `agent_grants` không UPDATE/TRUNCATE; danh sách trắng quyền |
| Khoá cũ | K01–K16 (C1 `CHAT_API_ERRORS` 6 mã, `test:contract:chat` 41, H1/H2*/H3a, M3 `hub-view.int`, M4 usage) |

## 5. Rủi ro chập chờn
| # | Rủi ro | Cách giữ |
|---|---|---|
| F1 | "Song song" bằng `Promise.all` có thể bị tuần tự hoá ở HTTP/pool ⇒ AC-05 xanh giả | Rào bằng khoá: `holdConfigMeta` → bắn 2 request → chờ `lockWaiters = 2` → `release()`; lặp 10 vòng (A45, A46) |
| F2 | Seed ∥ POST deadlock không tất định | A47 lặp 10 vòng + quan sát chờ khoá tất định A49; đếm `pgDeadlocks` (H1) trước/sau = 0 |
| F3 | NOTIFY: thông điệp ca trước / `version` lặp sau reset | `listenHub().mark()` đầu ca, tìm từ mốc (bẫy CONVENTIONS §2); sentinel cho ca "không NOTIFY" |
| F4 | Effective đọc **cache** (PL5) ⇒ sau POST chưa thấy ngay | chờ `hub_config_version` của effective ≥ version trả về từ POST (≤ 10 s) |
| F5 | 2 instance: LISTEN chưa sẵn sàng lúc POST | chờ cả hai instance phản hồi `GET /agents` với version hiện tại trước khi POST |
| F6 | Audit không dọn được ⇒ đếm lệch giữa ca | đếm theo `seq > mốc` + `entity_id`; không chạy song song file H3b |
| F7 | `pg_stat_activity` lẫn backend của file khác / pool cũ | lọc `datname` DB qc + `query ILIKE '%config_meta%'`; một file một lúc |
| F8 | Windows/Docker chậm ⇒ ≤ 1 s / ≤ 5 s đỏ | ngưỡng nới (§1), in ms; vượt AC ghi `test-plan-log` |
| F9 | Orchestrator thật (ScriptRuntime) chậm khi đo AC-H09 qua lượt gửi | khẳng định chính bằng `GET /agents`; lượt gửi chỉ kiểm danh sách agent trong prompt Orchestrator (`block()` H1), không chờ trả lời |

## 6. Lệnh — `bun run done:h3b` (MK, mẫu `done-h3a.ts`)
Mọi bước `done:h3a` + `bun test tests/acceptance/H3b/rules` (bước unit) + int `tests/acceptance/H3b/` (bước int; **không** gồm `H3b-cmd/` — G7) + cuối `test:lock:verify` · `trace --check`. `done-h3b.test.ts`: mọi tiêu đề `done:h3a` có mặt, `H3b/rules` trong bước unit, `H3b/` trong bước int, `H3b-cmd` vắng.

## 7. Nhóm WRITE · đợt khoá (sau Gate)
| Nhóm | Khi | File | Ca | Phải đỏ đúng lý do vì |
|---|---|---|---|---|
| QW-R | sau C1, B0 | `rules/{target-tenant,grant-problem,effective-agents,trace-rules,contracts-h3b}.test.ts` | R01–R61 (40) | stub ném `not implemented`. **Xanh trước code chấp nhận**: R60–R61 (contract C1 có), R42–R45 phần hằng regex (`SENSITIVE_*_RE` thật trong B0) |
| QW-A | sau D1, MK, QW-R | `H3b/*.int.test.ts` (9 file) | A01–A126 (91) | route chưa có ⇒ 404 thay 200/201/403/400/409 (`expect`). **Xanh trước code chấp nhận**: A01 (401 middleware có sẵn nếu prefix chưa thêm ⇒ 404 — ghi rõ), A101, A110 (CORS chưa đổi code), A120–A126 (D1 xong) |
| QW-C | cùng QW-A | `H3b-cmd/command-m5.int.test.ts` | A130–A134 (5) | đỏ ⇒ TECH-DEBT, không chặn (Q-K11). **Ngoài `done:h3b`**; qc chạy tay ở I1: `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H3b-cmd`, ghi `test-plan-log.md` (G7) |
| **Q2** | sau QW-A | `tests/.lock` | — | verify chỉ `UNLOCKED` H3b, 0 `CHANGED` |

Tổng mới **136** ca: R 40 · A 91 · A-cmd 5; + K 16 nhóm · M 1. Model: QW-R/QW-A = Opus (`cao`), Q2/I1 = Sonnet.

## 8. Chỗ hở cho readiness (mặc định dùng nếu không trả lời)
| # | Hở | Mặc định | Agent |
|---|---|---|---|
| G1 | AC-H08 "404 giống hệt (thân + header)" — `x-request-id`/`date` luôn khác | so `status` + `content-type` + thân bỏ `request_id` (nếu có) | qc |
| G2 | Thứ tự `VALIDATION_ERROR` vs `TENANT_REQUIRED`/404 tenant khi cả hai sai (plan §3 vs R04) | `VALIDATION_ERROR` trước (plan §3); không lộ tồn tại tenant vì không phụ thuộc DB — A12 khoá | backend-lead xác nhận |
| G3 | Mã 500 khi ghi lỗi (POST/DELETE/trace) chưa ghi tên | `INTERNAL_ERROR`, không `details` | backend-lead |
| G4 | `SENSITIVE_KEY_RE` khớp `token` ⇒ khoá `input_tokens`/`max_tokens` bị che | **Đã xử lý (readiness 1, PL16)**: regex `token(?!s)`; R42 bỏ `max_tokens`, thêm `access_token`/`token_hash`; R44 giữ `input/output/extra/max_tokens` | backend-lead |
| G5 | `redactTraceDetail`: "sâu > 6" và "> 16 KiB" chưa định nghĩa mốc | gốc = mức 1, giá trị ở mức 7 ⇒ MASK; 16 KiB = 16 384 byte UTF-8 của `JSON.stringify` **sau** che, `> 16384` ⇒ `{truncated:true}` | backend-lead |
| G6 | Thứ tự `reasons` ở hàm thuần (groupId) vs contract (`group.key`) | R22 so như tập; A65 khoá thứ tự contract (`grant_user` rồi theo `group.key`) | — |
| G7 | AC-13 "đỏ ⇒ TECH-DEBT, không chặn" mâu thuẫn nếu nằm trong `tests/acceptance/H3b/` (bước int `done:h3b`) | đặt ở `tests/acceptance/H3b-cmd/` (vẫn khoá), **ngoài** `done:h3b`; qc chạy tay ở VERIFY | backend-lead MK |
| G8 | Seed cộng dồn (`on conflict do nothing`): grant đã thu hồi qua API sẽ **sống lại** khi chạy `hub:seed` với YAML có grant đó | A47 chỉ khoá "seed không xoá grant API"; chiều ngược ghi TECH-DEBT, không test | docs-architect (TECH-DEBT) |
| G9 | Cách dựng app có `corsOrigins` admin-web trong test; mặc định env "không mở ngầm" | `createApp(cfg)` trực tiếp (A110–A112); mặc định env do unit `apps/hub-api/src/config` (B6) — qc không khoá | backend-lead |
| G10 | "member 403, **không đọc DB**" không quan sát được hộp đen | A02 khoá 403 trước validate + `stateOf` không đổi; đọc DB = unit middleware của backend-lead | — |
| G11 | A122 "danh sách trắng quyền" cần mốc trước `0009` | liệt kê tường minh quyền mong đợi của `hub_rw` trên `agent_grants`, `agent_entitlements`, `config_meta`, `audit_log`, `agents`, `orchestrator_settings` (từ `0000` §GRANT + `plan-db` §1) | qc |
| G12 | QP1 (actor bị khoá, JWT còn hạn) — không khoá test | không có ca; theo mặc định QP1 | — |
| G13 | POST trùng: `granted_by`/`granted_at` của hàng gốc hay actor hiện tại | hàng gốc (`FIND_GRANT`) — A23 | backend-lead xác nhận |

## 9. Cần bổ sung (agent: việc) · xử lý readiness lần 1 (2026-10-06)
| Mục | Trạng thái | Xử lý phía qc |
|---|---|---|
| G1 | Đã xử lý | So `status` + `content-type` + thân bỏ `request_id` (§1); docs-architect sửa chữ AC-H08 |
| G2, G3, G5, G13 | Đã xử lý | Nhận mặc định; backend-lead ghi một dòng PL mỗi mục |
| G4 | Đã xử lý | PL16, regex `token(?!s)`; R42/R44 đổi (§8) |
| G6, G9, G10, G11 | Đã xử lý | Nhận mặc định, không đổi |
| G7 | Đã xử lý | `H3b-cmd/**` ngoài `done:h3b`; qc chạy tay ở I1, đỏ ⇒ TECH-DEBT (§7); backend-lead thêm File vào tasks QW |
| G8 | Đã xử lý | docs-architect: TECH-DEBT + PRODUCTION-NOTES/`hub-dev.md` (YAML prod không chứa `grants`); A47 giữ nguyên |
| G12 | Đã xử lý | QP1 đã có 401 qua `accountUsable` (N4), không cần ca mới |
| N1 | Đã xử lý | R49 + A97b (PL15 `redactTraceDetail(detail, view)`) |
| N2 | Đã xử lý | A02b ⇒ 401 `AUTH_EXPIRED` |
| N3 | Đã xử lý | A66 tự khoá `gamma`, trả lại trong `finally`; §2.1 sửa |
| N4, N5, N6 | Không thuộc qc | backend-lead sửa plan/plan-db |
| N7 | Đã xử lý | `H3bExtra` bọc trong `_h3b.ts`, MK không phải làm gì (§2) |

## 10. Đỏ đúng lý do · nhật ký
Chưa chạy (QW sau Gate). Ghi vào `test-plan-log.md` khi có.
