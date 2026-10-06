# Readiness — H3b-agent-grants

## Lần 1 · 2026-10-06 · spec-readiness (Opus) · **NOT READY** → sửa một lượt
Đã đọc hết 8 file của thư mục spec tới `139accf`. Lớn nhất là `plan.md` 23 249 B, các file khác ≤ 22 777 B, đều trong trần 25 600 B. Mã yêu cầu: HUB-FR-78/79/52/87, HUB-BR-17/02/14, ADM-FR-37/36, AC-H08/H09/A11. Đã grep BA-H (:35, :194, :226–235, :246, :261, :308–312, :384) và BA-A (:127–128, :283): đều có thật và nội dung khớp. Riêng câu "chỉ trong đúng `tenant_id` của JWT" ở BA-H :311 lệch Q-U1, nhưng đã có I3 sửa. Đối chiếu code: `agents/agent-access.rules.ts` (`AccessSnapshot`, `accessInput`, `orchestratorIds`, `RUNNABLE_RUNTIMES`, `visibleAgents`), `config/config.rules.ts` (`TenantState`, `UserState`, `AgentConfig.name`), `config.service.ts` (`snapshot/tenant/user`), `config.repo.ts` (`loadUsers` lọc nhóm cùng tenant), `seed/seed.repo.ts` (`bumpHubConfigVersion` :11, `insertGrants` :169 `on conflict do nothing`, `notifyHubConfigChanged` :213), `lib/http.ts` (`parseWith`, `parseQuery` bỏ `tenant_id` :12/:49, `parseIdParam`), `lib/errors.ts` (`mapError` :94 ⇒ 500 `INTERNAL_ERROR`), `lib/auth.middleware.ts` (:26 `accountUsable`), `lib/jwt.ts` (:22/:40 role ∉ `ROLES` ⇒ null), `app.ts` (`PROTECTED_PREFIXES` :79, `cors` :197, `AppDeps` :48), `app.h2b.ts`, `runner/job/job-follow.ts` :143–152 (`detail`), `commands/driver/command-driver.ts` :91, `packages/db/src/hub-scope.ts`, `migrations-hub/0000` (`config_meta` chỉ 2 cột :27–33, GRANT :451–476, cột `runs/jobs/usage_logs`, index), `0003` (mẫu `SECURITY DEFINER` `log_dify_usage`), admin `0002_admin_rls.sql` :46–55 (cột `admin.users` cho `hub_ro`), contracts (`GrantSubjectSchema`, `GroupRefSchema` cần `is_beta`, `UpdatedBySchema`, `IsoDateTime`, `AgentKeySchema`, `HUB_CONFIG_CHANNEL`, `HUB_CONTRACT_VERSION`), test H1 (`_fixtures.ts` `T`/vai, `_hub.ts` `HubExtra`/`startHubX`/`hubConfigChange`/`pgDeadlocks`/`idGen`), `tools/scripts/src/done-h3a.ts` `h3aSteps`, `seed.ts` `runHubSeed`. Mọi symbol mà plan trỏ tới đều có thật.

Kết quả: 15 lỗ hổng (0 Chặn, 4 Cao, 4 Thường, 7 Thấp). Đánh giá G1–G13 của qc: G4 và G8 nâng lên **Cao**, các mục còn lại nhận theo mặc định. Thêm N1–N7. **Không có câu hỏi mới cho người dùng** (xem cuối mục).

| # | Mức | Vị trí | Lỗ hổng | Mặc định đề xuất | Ai sửa |
|---|---|---|---|---|---|
| N1 | Cao | spec R18 · plan P11/§4.3 · plan-db §5 :135 ↔ H1 `plan.md` P11 (H1-R26) · `job-follow.ts:143–152` | Với job lỗi, `detail` của step có `message` thô của Runtime (H1 P11 quy định "chỉ vào `run_steps.detail` + log, **không** ra client", vì có thể lộ provider, agent hoặc đường dẫn). Trace trả nguyên `detail` cho chủ run (member), nên phá luật đã chốt ở H1. plan-db giấu `jobs.error_message` vì đúng lý do này nhưng lại để lọt cùng nội dung qua `detail.message` | `redactTraceDetail(detail, view: "own" \| "platform")`. Khi `own`: bỏ hẳn khoá gốc `message` và `upstream` của `detail`. Khi `platform`: giữ nguyên để debug (HUB-BR-02). Ghi **PL15** + sửa chữ ký plan §4.3. qc thêm R49 (`own` bỏ `message`/`upstream`, `platform` giữ) và A97b (`R_lan` có step lỗi với `message` mẫu: chủ run không thấy, P thấy) | backend-lead (PL15, plan §4.3) + qc (R49, A97b) |
| G4 | Cao | plan §4.3 `SENSITIVE_KEY_RE` · test-plan-cases R42 | Regex khớp chuỗi con `token`, nên che cả `detail.usage.input_tokens`/`output_tokens` (mọi step job: `job-follow.ts:149`), `extra_tokens` (command: `command-driver.ts:91`) và `max_tokens`. Trace hiện `"••••"` thay cho số token, gây hiểu nhầm là bí mật bị che. Riêng usage của job lỗi và `extra_tokens` thì không có ở chỗ nào khác. Như vậy là làm hỏng một phần mục đích trace. R42 sẽ khoá hành vi sai này khi tới Q2 | Đổi thành `/(api[_-]?key\|secret\|token(?!s)\|password\|passwd\|authorization\|cookie\|credential\|private[_-]?key)/i`. `*_tokens`/`tokens_used` giữ nguyên; `token`, `access_token`, `refresh_token`, `token_hash`, `tokenBudget` bị che. Ghi **PL16** trước Q2. R42 bỏ `max_tokens`, thêm `access_token`, `token_hash`. R44 thêm `{input_tokens:5, output_tokens:7, extra_tokens:3, max_tokens:100}` và kỳ vọng giữ nguyên | backend-lead (plan §4.3, PL16) + qc (R42, R44) |
| N2 | Cao | test-plan-cases A02b · test-plan §4 "Role" ↔ `lib/jwt.ts:22,40`, `auth.middleware.ts:24` | JWT ký đúng nhưng `role:"owner"` bị `verifyAccessToken` trả null, nên ra **401 `AUTH_EXPIRED`** chứ không phải 403. A02b sẽ đỏ vĩnh viễn sau khi khoá | A02b đổi kỳ vọng thành 401 `AUTH_EXPIRED`, 0 ghi. R06 (hàm thuần `targetTenant` với role lạ ⇒ `FORBIDDEN`) giữ làm phòng thủ | qc |
| G8 | Cao | test-plan §8 G8 ↔ `seed.repo.ts:169` · `hub-dev.md:39` · PRODUCTION-NOTES 2026-10-05 ("Orchestrator theo tenant chỉ qua seed tới H4") | Tới H4, seed vẫn là đường duy nhất để quản entitlement và Orchestrator tenant, nên **sẽ chạy trên prod**. Khi YAML có grant, seed chèn lại grant mà `tenant_admin` đã thu hồi qua API: quyền sống lại, không có hàng audit, trái HUB-FR-78 "mọi thay đổi ghi audit" | H3b không sửa code seed (P5). (1) TECH-DEBT: "seed hồi sinh grant đã thu hồi + không audit". (2) Ghi vào PRODUCTION-NOTES + `hub-dev.md`: "từ H3b, mục `grants:` trong seed YAML chỉ dùng cho dev; YAML prod không chứa `grants` (grant quản lý bằng API)". (3) A47 giữ nguyên | docs-architect (I3) |
| G7 | Thường | test-plan §1, §6, §7 QW-C ↔ tasks QW cột File (`tests/acceptance/H3b/**`), I1 | Nhận mặc định: đặt ở `tests/acceptance/H3b-cmd/`, ngoài `done:h3b`; `extend` bằng `"tests/acceptance/H3b/"` có dấu `/` nên không lọc nhầm `H3b-cmd`. Nhưng tasks chưa ghi file `H3b-cmd/**` và chưa có bước chạy hay người ghi kết quả | tasks QW thêm `tests/acceptance/H3b-cmd/**` vào cột File. I1 thêm câu: qc chạy `bun --env-file=.env.local --config=bunfig.int.toml test --timeout 30000 ./tests/acceptance/H3b-cmd`, ghi `test-plan-log.md`; nếu đỏ thì ghi TECH-DEBT và không chặn. `done-h3b.test.ts` khẳng định `H3b-cmd` vắng (đã có trong test-plan §6) | backend-lead (tasks, MK) + qc |
| PL2 | Thường | spec R22 ("chỉ **thêm** GRANT `INSERT, DELETE`") ↔ spec §4, sd PL2, PL7, plan-db §1 | Chữ R22 lệch với §4 (thêm `UPDATE (hub_config_version)` và `usage_logs_run_idx`). **Đánh giá: không phải quyết định mới cần người dùng duyệt.** (a) Đây là hệ quả bắt buộc của R08/Q-K7, tức bump trong cùng transaction như seed. (b) Quyền chỉ trên một cột của một bảng 1 hàng, 2 cột (`0000:27–33`, CHECK `id = 1`, `≥ 0`). (c) Rủi ro thêm (đặt version tuỳ ý, giữ khoá chặn seed) nhỏ hơn nhiều so với `INSERT/DELETE agent_grants` mà R22 đã có; cache nạp lại khi version **khác**, không dựa vào việc version chỉ tăng. (d) Không lấy phương án hẹp hơn là hàm `SECURITY DEFINER` (mẫu `0003` `log_dify_usage`) vì thêm code mà không giảm rủi ro thật | Giữ PL2. docs-architect sửa R22 thành "chỉ thêm: GRANT `INSERT, DELETE agent_grants`, `UPDATE (hub_config_version) config_meta`, `SELECT, INSERT audit_log` cho `hub_rw`; bảng `audit_log`; index `usage_logs_run_idx`". Gate ghi một dòng "mở quyền DB" để reviewer kiểm (A120–A122 khoá đúng cột) | docs-architect (R22) |
| N3 | Thường | test-plan §2.1 ("`gamma` (tenant không hoạt động)") · A66 ↔ `tests/acceptance/H1/_fixtures.ts:140` | Trong fixture, `gamma` có `active = true` (người ta bật/tắt nó trong ca H1 A2). Nếu A66 dựa vào fixture thì sẽ không ra `tenant_locked` | Trong A66: dùng owner chạy `UPDATE admin.tenants SET active=false` cho `gamma` + `adminChange` (NOTIFY), chờ cache, gọi effective, rồi trả lại trong `finally`. Sửa câu §2.1 thành "`gamma` (đổi `active` trong ca)" | qc |
| G5 | Thường | plan §4.3 `redactTraceDetail` | Nhận mặc định của qc: gốc là mức 1, giá trị ở mức 7 ⇒ MASK; ngưỡng 16 KiB = 16 384 byte UTF-8 của `JSON.stringify` **sau** khi che, `> 16384` ⇒ `{truncated:true}` | Ghi một dòng PL (gộp vào PL15/PL16) | backend-lead |
| G2 | Thấp | plan §3 ↔ R04 | Nhận mặc định: `VALIDATION_ERROR` trước lỗi tenant (không phụ thuộc DB, A12) | Một dòng PL | backend-lead |
| G3 | Thấp | plan §3 "500" | Đóng theo code: `mapError` (`errors.ts:94`) ⇒ 500 `INTERNAL_ERROR`, không `details` | Một dòng PL | backend-lead |
| G13 | Thấp | plan §5.2 bước 4 | Nhận mặc định: POST trùng trả `granted_by`/`granted_at` của hàng gốc (`FIND_GRANT`) | Một dòng PL | backend-lead |
| G1 | Thấp | spec-ac AC-H08 "thân + header" | Nhận mặc định: so `status` + `content-type` + thân bỏ `request_id`. Hai header `x-request-id`/`date` luôn khác nhau | Sửa chữ AC-H08 theo đúng mặc định | docs-architect |
| N4 | Thấp | plan §10 QP1 · test-plan G12 ↔ `auth.middleware.ts:26` | QP1 dựa trên tiền đề sai: `authenticate` **đã** kiểm `accountUsable` từ cache, nên actor bị khoá hoặc vô hiệu nhận 401 sau khi cache nạp lại (≤ 5 s) | Sửa QP1 thành "đã có: 401 qua `accountUsable`". Đóng G12, không cần ca mới | backend-lead |
| N5 | Thấp | plan-db :3 ("mọi câu … `admin.users` … có `tenant_id = T`") ↔ `ACTOR_NAME`, join `gb` trong `LIST_GRANTS` | Hai câu này cố ý không lọc tenant (actor có thể là platform_admin, QP2). Nếu không ghi rõ, rubric RV "mọi câu có `tenant_id`" sẽ bắt nhầm | Thêm vào :3 câu "trừ `ACTOR_NAME` và `granted_by` (chỉ lấy `username`, QP2)" | backend-lead |
| N6 | Thấp | plan §2.2 `GrantSubject`, §2.3 `grant_group` ↔ contracts `groups.ts:40–55` | `GroupRefSchema` strict, bắt buộc có `is_beta` (refine `is_beta ⇔ key = beta-testers`), nhưng SQL chỉ lấy `id, key, name` | Ghi map `is_beta = key === BETA_GROUP_KEY` ở plan §2.2 | backend-lead |
| N7 | Thấp | test-plan §2 "Hub", §9 ↔ `tests/acceptance/H1/_hub.ts:158,166` | `HubExtra` (H1, đã khoá) không có `hubAudit`. Nhưng `startHubX` trải `...extra` vào `deps`, nên truyền được qua một biến có kiểu rộng hơn (mẫu H2b `H2bExtra`) | qc dùng `type H3bExtra = Omit<HubExtra,"signal"> & Pick<AppDeps,"hubAudit">` trong `_h3b.ts`. MK không cần làm gì | qc |

Các mục còn lại của qc, nhận theo mặc định và không cần sửa: G6 (so `reasons` như tập ở R22, thứ tự kiểm ở A65), G9 (`createApp` không cần DB; `cors` đứng trước `mountProtected` (`app.ts:197–213`), phương thức mặc định của Hono có `DELETE`), G10, G11.

**Đánh giá trọng tâm:**
- **Cách ly tenant: Đạt.** `targetTenant` chỉ chạy một lần (P7), mọi SQL đều có `T` (plan-db §2–§5, trừ N5 là cố ý). Ma trận chéo phủ 5 endpoint × vai (test-plan §3.1). Trace quyết role **trước** khi mở scope `system` (P10, R40/R41), câu trace lọc thêm `tenant_id = run.tenant_id` (K10, A100). Đã xác minh: `admin.groups/users/tenants` cho `hub_ro` có `USING (true)` (admin `0002`/`0006`), nên lọc ở repo là lớp chặn duy nhất, đúng như R03/Q-K6 đã nêu.
- **Audit trace fail-closed: Đạt.** Audit nằm trong cùng transaction, chạy ngay sau `TRACE_RUN` và trước các câu đọc còn lại (PL11). Nếu lỗi thì rollback ⇒ 500, không trả thân (A98). Khi `withHubScope` thử lại do 40P01/40001, transaction trước đã rollback nên không có hàng audit thừa. Lỗi map sau commit thì vẫn ghi audit (thừa còn hơn thiếu). Còn hở N1: không phải hở về audit mà là nội dung `detail`.
- **Thứ tự khoá: Đạt.** Thứ tự `config_meta` → `agent_grants` → `audit_log` cùng chiều với seed. Phần kiểm agent/subject chạy trước khoá, nhưng kết quả tương đương một thứ tự tuần tự (grant còn giữ khi entitlement bị thu hồi là đúng R10), nên không có bất thường.

**Mâu thuẫn giữa tài liệu:** spec R22 ↔ spec §4/PL2/PL7 (giữ §4); H1 P11 ↔ H3b R18/P11 về `detail.message` (giữ H1, N1); test-plan §2.1 ↔ fixture H1 về `gamma` (giữ fixture, N3); A02b ↔ `jwt.ts` (giữ code, N2); QP1 ↔ `auth.middleware.ts` (giữ code, N4); BA-H §9.1 "chỉ tenant JWT" ↔ Q-U1 = A (đã có I3 sửa BA).

**Không có câu hỏi mới cho người dùng.** Q-U1–Q-U4 đã chốt ở U6. PL2 là quyết định kỹ thuật buộc phải có, mặc định an toàn (xem dòng PL2). N1 theo quyết định H1-R26 đã duyệt. G8 có mặc định thuần thủ tục, không đổi code. G4 và G7 là kỹ thuật.

**Checklist:**

| Mục | Kết quả | Bằng chứng |
|---|---|---|
| A Phạm vi | Đạt | spec §1 + "Không làm" |
| B Contract | Đạt | plan §2–§3; NOTIFY không đổi (spec §3) |
| C Dữ liệu | Đạt | plan-db §1 (bảng, CHECK, 3 index, trigger, GRANT), §2–§5 index; không RLS có chủ đích (Q-K6, PL6); chữ R22 ở I |
| D Nghiệp vụ | **Thiếu** | N1 (lộ `message` thô), G8 (thu hồi không bền khi chạy seed) |
| E UI | Đạt | Không có UI (U1, spec §5 CR-impact) |
| F Kiểm chứng | **Thiếu** | N2 (A02b), N3 (`gamma`), G4 (R42 khoá hành vi sai), G7 (chưa có bước chạy `H3b-cmd`) |
| G Phụ thuộc | Đạt | spec §7; `fake-cli`/mock Dify H2a; `runHubSeed` có thật; không env mới (plan §8) |
| H2 Vai trò | Đạt | spec §3–§4 đã điền; chữ ký thuần plan §4; mọi FR MUST có ca (test-plan §3.2) |
| H Task | Đạt (trừ G7) | tasks có File/Phụ thuộc/Lệnh xong/Rủi ro; task chạm quyền/khoá/audit/GRANT đều `cao` (B0, MK `thường` hợp lệ) |
| I Nhất quán | **Mâu thuẫn** | R22 ↔ §4 (PL2), QP1, plan-db :3 (N5) |
| J Độ chính xác | Đạt trừ các mục trên | N6 (`is_beta`) |

**Quét từ mơ hồ:** 45 kết quả. Tất cả vô hại: "…" là chỗ rút gọn SQL/đường dẫn/khoảng; "có thể" xuất hiện trong câu mô tả rủi ro (plan-db :135, test-plan F1) và tiêu đề Q-K; "tuỳ chọn" = bộ lọc optional đã định nghĩa (R11); "sau này" nằm trong rủi ro K11. Không có kết quả nào thành lỗ hổng.

**Chưa kiểm:** `docs/design/agent-hub/ui-operations.md` §4/§8 và `ui-admin.md` §7.14–7.15 (ngoài phạm vi phiên Hub, U1 → CR-impact); không chạy lệnh nào.

Lần chạy lại chỉ đọc `git diff 139accf -- docs/specs/H3b-agent-grants/` và các lỗ hổng N1–N7, G1–G8, PL2.

## Lần 2 · 2026-10-06 · spec-readiness (Opus) · **READY**
Chỉ đọc `git diff 937c805 -- docs/specs/H3b-agent-grants/ docs/TECH-DEBT.md docs/guides/hub-dev.md` (commit `91fa28a` backend-lead, `9493ba3` docs-architect, `432cc4d` qc), các mục trỏ tới (plan :33/:96–100/:168, plan-db :86, spec R04 :65, §4 :111) và `packages/contracts/src/groups.ts:19` (`BETA_GROUP_KEY` có thật). Trần: lớn nhất `test-plan-cases.md` 24 344 B, `plan.md` 23 710 B, đều ≤ 25 600 B.

**Đối chiếu lần 1, cả 16 mục đã đóng:**

| # | Trạng thái | Bằng chứng |
|---|---|---|
| N1 | Đóng | sd PL15 · spec H3b-R49 :90 · plan §4.3 chữ ký `redactTraceDetail(detail, view)` + §5.4 bước 5 · R49 · A97b · test-plan §3.2 R18, AC-10 |
| G4 | Đóng | sd PL16 · spec R18 :89 · plan §4.3 `token(?!s)` · R42 (thêm `token`/`token_hash`/`tokenBudget`, bỏ `max_tokens`) · R44 (`*_tokens` giữ số) |
| N2 | Đóng | A02b ⇒ 401 `AUTH_EXPIRED` · test-plan §4 "Role" |
| G8 | Đóng (phần H3b) | TECH-DEBT #72 · `hub-dev.md` :41 · spec §10 K8. PRODUCTION-NOTES để I3 (xem L4) |
| G7 | Đóng | tasks QW cột File có `H3b-cmd/**` · I1 có lệnh chạy tay + ghi `test-plan-log.md` · test-plan §7 QW-C |
| PL2 | Đóng | spec R22 :137 liệt kê đủ GRANT 3 bảng, khớp §4 :111 (còn sót index, xem L3) |
| N3 | Đóng | test-plan §2.1 · A66 tự khoá `gamma`, trả lại trong `finally` |
| G5 | Đóng | PL15 + plan §4.3 (gốc = mức 1; `> 16384` byte UTF-8 sau che) · R45/R46 |
| G1 | Đóng | spec-ac AC-H08 sửa chữ |
| N4 | Đóng | plan §10 QP1 |
| N5 | Đóng | plan-db :3 |
| N6 | Đóng | plan §2 (`is_beta = key === BETA_GROUP_KEY`, hằng có ở `groups.ts:19`) |
| N7 | Đóng | sd PL17 · test-plan §2 "Hub" |
| G2 | Đóng, **không cần PL riêng** | Thứ tự đã có ở spec R04 :65 (body hợp lệ → R02) + plan §3 :96–97, A12 khoá cả `tadmin ≠ tid` và `padmin` thiếu `tenant_id` |
| G3 | Đóng, **không cần PL riêng** | plan :33 (`INTERNAL_ERROR` 500) + :100 + `mapError` (`errors.ts:94`, lần 1); không có lựa chọn nào khác |
| G13 | Đóng, **không cần PL riêng** | plan §5.2 bước 4 :168 trả `FIND_GRANT` = `id, granted_by, granted_at` của hàng có sẵn (plan-db :86) · A23 |

**Lỗ hổng mới (0 Chặn, 0 Cao, 5 Thấp):**

| # | Mức | Vị trí | Lỗ hổng | Mặc định đề xuất | Ai sửa |
|---|---|---|---|---|---|
| L1 | Thấp | spec :90 `H3b-R49` ↔ plan :3, test-plan :4 ("H3b-R01…R23"), test-plan :4 + tasks P0 :16 ("PL1–PL14") | Số luật nhảy từ R23 lên R49 và trùng ID ca unit `R49`; các dải tham chiếu vẫn là R01…R23 và PL1–PL14 | Đổi tên thành `H3b-R24`. Sửa dải thành "R01…R24" và "PL1–PL17" (test-plan :4). tasks P0 đã `[x]` nên giữ nguyên | docs-architect + qc (:4) |
| L2 | Thấp | plan §4.3 docstring, PL15 | Với view `own`, chưa ghi rõ đo 16 KiB trước hay sau khi bỏ `message`/`upstream`. Cả hai cách đều an toàn, không ca nào phân biệt | Bỏ khoá gốc trước, rồi che, rồi đo kích thước. Ghi nửa dòng vào PL15 | backend-lead |
| L3 | Thấp | spec R22 :137 ↔ §4 :111, plan-db §1 | R22 "chỉ thêm bảng audit + GRANT" chưa có index `usage_logs_run_idx` | Thêm "· index `usage_logs_run_idx`" vào R22 | docs-architect |
| L4 | Thấp | spec K8 ("I3: PRODUCTION-NOTES cần thêm câu này") ↔ tasks I3 (danh sách mục chờ PRODUCTION-NOTES) | I3 chưa có mục "YAML seed prod không chứa `grants:`" | Thêm mục này vào I3 | docs-architect |
| L5 | Thấp | test-plan §9 (G2, G3, G5, G13 "backend-lead ghi một dòng PL mỗi mục") | Chưa có PL nào cho G2, G3, G13, và cũng không cần (xem bảng trên), nên câu này là chữ cũ | Sửa thành "G2/G3/G13 đóng theo R04, plan :33/:168; G5 ở PL15" | qc |

**Nhất quán mới:** đã kiểm PL15/PL16 khớp spec R18/R49, plan §4.3/§5.4, R42/R44/R49, A97b. Nhánh `own` cũng áp dụng cho `platform_admin` khi là chủ run (A95). Điều này khớp `traceAccess` và Q-U4, không mâu thuẫn. Tổng số ca test-plan §7 (R 40, A 91, A-cmd 5, tổng 136) khớp với các ca mới thêm (R49, A97b). Không có mâu thuẫn mới nào ở mức Thường trở lên.

**Không có câu hỏi mới cho người dùng.**

**Checklist:** A, B, C, E, G, H2, H: Đạt (như lần 1). D: Đạt (N1 qua R49/PL15, G8 qua K8 + TECH-DEBT #72). F: Đạt (A02b, A66, R42/R44, I1 `H3b-cmd`). I: Đạt, trừ L1/L3 (Thấp). J: Đạt (N6).

**Quét từ mơ hồ** (chỉ trên diff): 2 kết quả, đều vô hại. "có thể lộ provider…" (spec :90) là câu nêu lý do. "…" (spec-ac, plan-db :114) là chỗ rút gọn.

**Chưa kiểm:** `docs/PRODUCTION-NOTES.md` đang có thay đổi chưa commit của phiên khác (dòng C1, ngoài H3b), không đụng tới. Không chạy lệnh test.

Lần chạy lại (nếu có) chỉ đọc `git diff <commit lần 2> -- docs/specs/H3b-agent-grants/` cho L1–L5.
