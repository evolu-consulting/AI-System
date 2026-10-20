# CR-095 · Security review của các lát sửa sau review đợt A/B/C

- Nhánh `platform/gd0`, phạm vi `00edb430..36acedb6` (25 commit, bỏ thay đổi chỉ có docs). Chỉ đọc mã; file này là thay đổi duy nhất.
- Lát: M2c (token tool chat Dify), M1c (luật thấy, contracts 0016), W1c/W1b (sourcing, hẹn nhắc), M3c (worker, hub 0043, pack 0017),
  L1c (giới hạn đăng nhập), I1c (importer), R1c/G1 (knowledge 0005, AI client, trần), F1c (evotest).
- Không chạy test (reviewer chỉ đọc; bộ int chạy trên evotest). Kết luận dựa trên đọc diff và mã xung quanh.

## Kết luận: **SAFE**

Không thấy đường đọc/ghi chéo tenant, leo thang quyền, vượt xác thực hay dùng lại token sau khi run kết thúc.
Mọi lỗi Cao của đợt B và C đã đóng. Lỗi bảo mật B #9 (sourcing), #25 (tri thức chéo tenant) và #13 (trần AI) đã đóng.
Còn **một lỗi Trung trong một tenant**: A-2 (khoá bên giả được) mới đóng một nửa (N-1). Nên sửa trước khi bật chế độ `org` cho khách.

Đếm lỗi mới: Chặn 0 · Cao 0 · Trung 1 · Thấp 9.

## Trạng thái lỗi gốc

| Lỗi gốc | Mức gốc | Trạng thái | Ghi chú |
|---|---|---|---|
| B #5 worker không chạy lại | Cao | **CLOSED** | `extract-stream.redis.ts:254` giám sát + backoff, dừng theo `signal`. |
| B #6 NOGROUP cache vĩnh viễn | Cao | **CLOSED** | `groupLost` ⇒ `groupReady = null`, tạo lại group, chạy lại một lần (`:65-121`). |
| B #7 STALE khi còn xếp hàng | Cao | **CLOSED** | `queued_at` (0017) + `staleMinutesFor(claimIdleMs)`; sweep tách hàng đợi và đang chạy. |
| B #8 tiêu đề > 200 chặn hàng đợi | Cao | **CLOSED** | `left(...,200)`/`left(...,2000)` khi enqueue + `skipHead` cho hàng xấu. |
| B #9 sourcing lộ qua luật thấy | Cao | **CLOSED** | Xem W1c bên dưới. |
| B #20 checkpoint theo vị trí | Cao | **CLOSED** | Khoá lô = sha1 nội dung (`import.usecase.ts:165-171`), có int test chạy tiếp. |
| B #21 `lot_id` treo FK | Cao | **CLOSED** | `lotRef` ⇒ null + `LOT_MISSING` (`map-cks.rules.ts`). |
| C F-01 domain import application | High | **CLOSED** | `graph.rules.ts:4` nay import `./graph.types`. |
| C F-02 `-Dirty` bỏ file đã stage | High | **CLOSED** | `run-tests.ps1:27` thêm `diff --cached`. Còn sót: file đã stage để xoá không được gửi (Thấp, không bảo mật). |
| A-1 `cks_signed_docs` không có luật thấy | Trung | **CLOSED** | RESTRICTIVE trên `cks_signed_docs`, `cks_followups`, `partner_event_voids` + kiểm khách trong cùng câu. Còn `contract_reminders` (N-4). |
| A-2 khoá bên giả được | Trung | **OPEN (một phần)** | HĐ nháp đã bị chặn, nhưng vẫn giả được bằng hai đường khác (N-1). |
| A-3 TOCTOU khoá tài khoản | Trung | **CLOSED** | PRE giữ chỗ trong zset `p:<acct>`: `f + pending < 5` trong cùng script Lua; FAIL/SUCCESS/RELEASE nhả chỗ; chỗ tự hết hạn sau 30 s. |
| A-4 importer ghi vào tenant đã tắt/thu hồi | Trung | **CLOSED** | `identity.adapter.ts:44` + lọc `active && !packRevoked`, báo `skipped_tenants`. |
| A-5 Dify giữ `inputs` lượt đầu | Trung | **CLOSED** | Tách handle hội thoại và grant theo run (xem M2c). |
| A-6 XFF thiếu phần tử | Thấp | **CLOSED** | `client-ip.ts:18` ⇒ null; IPv6 gộp theo /64. |
| A-8 xoá `app.user_id` khi lan phụ lục | Thấp | **CLOSED** | Cờ `app.vis_cascade` chỉ policy `contracts_visible` nhận; lỗi giữa chừng thì `set_config` local bị hoàn cùng subxact. |
| A-9 `contracts_rw` ghi `visibility_settings` | Thấp | **CLOSED** | RESTRICTIVE INSERT/UPDATE: `org_is_owner()` hoặc việc nền. |
| A-16 void khớp nhầm nguồn | Thấp | **CLOSED** | Join thêm `mgmt_source`, `map-ledger` gửi `source`. |
| A-18 token sống sau khi hub chết | Thấp | **CLOSED** | `/mcp` kiểm `hub.runs.status = 'running'` theo PK + tenant (`mcp.service.ts:121`). |
| A-19 `pack_tools` không kiểm | Thấp | **CLOSED** | `checkPackTools` theo registry khi tạo và sửa agent. |
| B #13 trần token AI kiểm-rồi-gọi | Trung | **CLOSED** | Xem M3c. |
| B #14 không ghi usage khi lỗi | Trung | **CLOSED** | Provider trả usage một phần; `settle` luôn ghi. |
| B #25 quan hệ tri thức chép sang tenant khác | Trung | **CLOSED** | `relTenants`: có `evidence` mà đoạn không được nhập ⇒ không tenant nào. Còn phần thiết kế ở N-9. |
| C F-03 deadlock nhánh xoá df | Medium | **CLOSED** | Knowledge 0005: `SELECT … ORDER BY tenant_id, lexeme FOR UPDATE` trước UPDATE, vẫn INVOKER và REVOKE PUBLIC; có int test. |
| C F-07 LLM tri thức đi vòng AI client | Medium | **CLOSED** | Rerank và đồ thị qua `clientAsk` với `who.tenantId`, có `feature`, nên có usage và trần. Embedding (OpenAI) vẫn fetch riêng, chỉ khi `KNOWLEDGE_STRATEGY=embedding`. |

## Theo trọng tâm

### 1. M2c: handle hội thoại + grant theo run

Đã kiểm, ổn:
- **Handle không có quyền.** `resolve` cần ba điều: handle (sha256 trong Redis) → binding; grant `mcp:chat-grant:<conv>:<agent>`
  còn hạn; `sameBinding` khớp tenant, user, conversation và agent. Sau đó `/mcp` kiểm thêm run còn `running`.
- **Không dùng chéo tenant hoặc user.** Handle của user A trên grant của user B (cùng conversation và agent) lệch `userId`, nên trả null.
  `conversation_id` là uuid NOT NULL của hub, nên không có khoá chung kiểu `null`.
- **Không dùng lại sau run.** `finally` thu hồi grant. Hub chết giữa run thì grant hết TTL (≤ 1 giờ), còn `runIsRunning` chặn ngay khi run
  không còn `running`. Tool lọc `read` hai lần (lúc cấp và lúc resolve), ngữ cảnh `readOnly`, không KH/file/job.
- **TTL.** Grant kẹp trong [60 s, 3600 s]. Run dài hơn 1 giờ mất tool (đóng an toàn, đã ghi). Handle trượt 24 giờ; hết hạn thì mở hội thoại
  Dify mới kèm handle mới, handle cũ bị xoá.
- Redis chỉ giữ sha256 của handle; không log bản rõ.

Lỗi mới: N-2, N-3 (Thấp).

### 2. M1c: migration 0016

- A-1 đã đóng (xem bảng). Policy dùng EXISTS trên bảng cha, nên RLS của bảng cha áp bên trong (INVOKER). Không có hàm DEFINER mới.
- `app.vis_cascade` là GUC tự do, nhưng chỉ SQL của app đặt được. Không route nào nhận tên GUC từ đầu vào. Cờ được trả lại giá trị cũ
  cuối trigger.
- A-2 chưa đóng hẳn: N-1.

### 3. W1c: `/sourcing`

Lọc theo luật thấy đã phủ mọi đường. Chỉ có hai route (`GET /sourcing`, `PUT /sourcing/:contractId/:line`), và cả hai đi qua
`visibleSalesOf`.
- Dữ liệu thô của tenant được lọc bằng `visibleTo(raw, ids)` **trước** `priceLines`. `ids` đọc dưới RLS của người xem.
- Lựa chọn nguồn chỉ được giữ khi người xem thấy cả HĐ bán lẫn HĐ nguồn.
- Phụ lục ẩn không còn thay giá, và phụ lục mồ côi bị bỏ (test `sourcing-visibility.rules.test.ts` và int).
- Cache `views` khoá theo tập id đã sắp, nên hai người cùng tập thấy cùng kết quả: đúng.
- `PUT` kiểm `itemExists` dưới RLS, rồi `isCandidate` trên dòng người đó thấy.
- `report()` dựng từ dữ liệu không lọc, nhưng chỉ test dùng.

### 4. M3c: hub 0043 giữ chỗ token

- Giữ chỗ là nguyên tử: advisory xact lock theo tenant, trong một câu `select … from hub.ai_reserve_tokens(...)`. Câu đó tính
  usage + chỗ đang giữ + input ước tính, cấp `min(max_output, phần còn lại)`. Đua N lời gọi không vượt trần (có test `ai-cap-race`).
- Tiến trình chết: chỗ giữ hết hạn sau 2 giờ, tức là tính dư (an toàn về chi phí). Bảng REVOKE PUBLIC, không có quyền trực tiếp cho `hub_rw`.
  Hai hàm DEFINER ghim `search_path`, EXECUTE chỉ cấp cho `hub_rw`.
- Tenant lấy từ `req.tenantId` của caller trong hub (không từ client).
- Lỗi mới: N-5, N-6, N-7 (Thấp).

### 5. L1c

- Atomicity: kiểm IP, khoá, rồi `f + ZCARD(pending) ≥ 5 ⇒ busy`, rồi ZADD, tất cả trong một EVAL. FAIL ZREM + ghi lần sai trong một EVAL.
  `success` dùng MULTI (DEL + ZREM). `finally` nhả chỗ cho lối ra khác (khoá DB, lỗi). Một đợt song song nay tối đa 5 lần verify mỗi chu kỳ.
- XFF: `parts.length < hops ⇒ null` (xô `unknown`), lấy phần tử thứ `hops` từ phải. IPv6 gộp theo /64. IPv4-mapped giữ nguyên.
- Lỗi mới: N-8 (Thấp).

### 6. I1c: tenant scoping

- Chỉ nhập vào tenant `active` và chưa thu hồi gói `contracts-*` (cùng luật N5).
- Void join thêm `mgmt_source`. REL có `evidence` chỉ vào tenant của đoạn đó. Checkpoint theo nội dung có `tid` trong khoá.
- Lỗi mới: N-9 (Thấp, thiết kế).

### 7. R1c

- Migration knowledge 0005 (xem bảng F-03): thứ tự khoá đúng, giữ INVOKER và REVOKE.
- `clientAsk` truyền `who.tenantId`/`userId`, nên usage `knowledge.rerank` / `knowledge.graph` đi vào trần của tenant.
  Client không sẵn sàng thì trả null (không gọi).
- Cap F-10 (neighbourhood/corpus) có test perf lệch phân phối. Không thấy vấn đề bảo mật.

## Lỗi mới

| # | Mức | Lát | Vị trí | Vấn đề và tình huống hỏng | Sửa đề xuất |
|---|---|---|---|---|---|
| N-1 | Trung | M1c (A-2) | `apps/hub-api/src/modules/packs/contracts/domain/approval-edit.rules.ts:8-12,45-47`; `domain/approval-machine.rules.ts:51,60`; `migrations-pack-contracts/0016_m1c_visibility.sql:4-12` | `visible_party_keys()` nay chỉ lấy từ HĐ đã duyệt, nhưng editor vẫn có hai cách tự tạo khoá bên. **(a)** PATCH `buyer_tax_id`/`supplier_tax_id` của một HĐ `active` do mình phụ trách: `MONEY_FIELDS` chỉ có tiền, nên `editVerdict` trả `ok`, HĐ giữ `active`, và khoá bên đổi sang MST của đối tác bất kỳ. Editor đó thấy `cks_customers` và sổ `partner_events` (công nợ, thanh toán) của đối tác trên HĐ người khác. **(b)** Tạo HĐ nháp với MST đích và giá trị dưới ngưỡng, mở duyệt, rồi tự Xác nhận cấp 1: người bắt đầu được duyệt cấp 1 (`canAct` level1 chỉ cần `inLevel1`), nên HĐ thành `active`. | Đưa các trường bên (`buyer_name`, `buyer_tax_id`, `supplier_name`, `supplier_tax_id`) vào nhóm "mở lại duyệt" như trường tiền. Với (b): cấm người bắt đầu duyệt cấp 1, hoặc chỉ lấy khoá bên từ HĐ có `confirmed_by <> created_by`. Hoặc chuyển `partner_events` sang lọc theo `contract_id` thấy được. Thêm test abuse cho cả hai đường. |
| N-2 | Thấp | M2c | `apps/hub-api/src/modules/mcp/chat-token.ts:20,122-131,142-152` | Handle nằm trong `inputs` của hội thoại Dify (DB/log Dify), và dùng được cho **mọi** run sau của hội thoại đó trong 24 giờ trượt. Trước đây token chỉ sống một run. Tình huống: ai đọc được log/console Dify lấy được handle một lần, rồi gọi `/mcp` bằng quyền đọc của user mỗi khi user chat tiếp. Vẫn chỉ đọc, cùng user và tenant, và chỉ trong lúc có run `running`. | Ghi vào spec như đánh đổi đã chấp nhận. Có thể giảm `HANDLE_TTL_S` (ví dụ 2–4 giờ), xoay handle khi user đăng xuất hoặc bị khoá, xoá `mcp:chat-conv:*` khi xoá hội thoại. Cân nhắc rate limit `/mcp` theo handle. |
| N-3 | Thấp | M2c | `chat-token.ts:111-118,122-127` | (a) `revoke` là GET rồi DEL (không nguyên tử). Run 1 đọc grant của mình; run 2 (cùng conversation và agent) ghi grant mới; run 1 DEL xoá grant của run 2, nên run 2 mất tool. Đây là đóng an toàn. (b) Hai run song song dùng chung một grant, nên tool của run 1 chạy với `runId` của run 2 (sai quy thuộc audit, cùng user). (c) `refreshHandle` không so binding (user), nên ở hội thoại dùng chung, user B gia hạn handle của A. Tool của B hỏng (đóng an toàn). | Thu hồi bằng Lua compare-and-delete theo `runId`. Khoá grant theo run (`grant:<conv>:<agent>` → set run đang chạy), hoặc chặn hai run song song trên một conversation. So binding trong `refreshHandle`. |
| N-4 | Thấp | M1c | `migrations-pack-contracts/0001_init.sql:170` (bảng `contract_reminders`) | A-1 đề nghị rà cả `contract_reminders`, nhưng bảng này vẫn chỉ có RLS tenant. Một truy vấn sau này đọc thẳng bảng sẽ thấy id HĐ, hạn và người nhận của HĐ mình không thấy. Hiện chỉ đọc qua join với `contracts` (`mywork.repo.ts:52`). | Thêm RESTRICTIVE SELECT `EXISTS contracts` như `contract_items`. |
| N-5 | Thấp | M3c | `apps/hub-api/src/lib/ai-client/ai-client.ts:154-159` | `settle` vẫn trả chỗ giữ khi `record` lỗi. Token đã tiêu khi đó không được tính vào trần (DB chập chờn nên tenant vượt trần dần). | Lỗi ghi usage thì **giữ** chỗ (để tự hết hạn sau 2 giờ). Chỉ release khi record thành công. |
| N-6 | Thấp | M3c | `packages/db/migrations-hub/0043_m3c_ai_token_holds.sql:58-62` | `hub.ai_release_tokens(p_hold_id)` xoá theo id, không kèm tenant. Không khai thác được (uuid ngẫu nhiên, chỉ `hub_rw`), nhưng thiếu phòng thủ chiều sâu. | Thêm `p_tenant_id` và `AND tenant_id = p_tenant_id`. |
| N-7 | Thấp | M3c | `apps/hub-api/src/modules/packs/contracts/extraction.mount.ts:143-152` | `withFallback`: XADD lỗi (Redis down) thì `void handle(j)` chạy ngay trong tiến trình, **không giới hạn đồng thời**. Một loạt upload/trích lúc Redis down mở N lượt AI + PDF song song trong hub-api (CPU/RAM). Trần token chỉ chặn chi phí, không chặn tải. | Đưa qua cùng semaphore `concurrency`, hoặc trả 503 khi đã có quá K lượt dự phòng đang chạy. |
| N-8 | Thấp | L1c | `apps/admin-api/src/lib/client-ip.ts:18`; `auth/limit/limit.redis.ts` (PRE kind 3) | (a) `TRUST_PROXY_HOPS` đặt cao hơn số proxy thật thì mọi request rơi vào xô `unknown` chung (30 lần mỗi cửa sổ cho cả hệ thống). Đóng an toàn nhưng là DoS do cấu hình. (b) Attacker giữ liên tục 5 lượt đang chạy cho một tài khoản thì user thật nhận 429 `busy` (cùng lớp với A-7). | Cảnh báo lúc khởi động hoặc metric khi tỉ lệ `unknown` cao. Ghi (b) cạnh A-7 trong runbook. |
| N-9 | Thấp | I1c | `apps/admin-api/src/modules/mgmt-import/domain/map-knowledge.rules.ts:139,159-160` | REL không có `evidence` và mọi ALIAS_OF vẫn được chép vào **mọi** tenant có cả hai thực thể. Quan hệ hay bí danh học từ tài liệu của org A có thể hiện ở tenant B (lộ suy luận, không lộ văn bản). | Nếu mgmt-app có org của cạnh, chỉ chép vào tenant đó. Không có thì ghi quyết định vào `docs/specs/I1-import/tasks.md`. |
| N-10 | Thấp | F1c | `deploy/evotest/run-tests.ps1:27-31` | File đã stage để xoá có trong danh sách, nhưng `Test-Path` false nên bị bỏ. Server vẫn test bản còn file đó (xanh giả với test phụ thuộc file đã xoá). | Gửi danh sách xoá riêng (`--diff-filter=D`) để server xoá trong overlay. |

## Đã kiểm, ổn (thêm)

- `mcp.repo.ts::runIsRunning` có `tenant_id` trong WHERE, một câu theo PK. `checkPackTools` chạy trong tx ghi cấu hình, trước audit.
- `followup-send.repo.ts`: `skipHead` lọc `tenant_id` tường minh, `FOR UPDATE SKIP LOCKED`, trong tx `contracts_rw` có RLS.
- Sweep M3c: `for update of c skip locked`, ghi có điều kiện. `healed` chỉ chuyển approval khi `c.run_id = x.id`.
- `limit.keys.ts`: SHA-256 không đổi định dạng khoá, nên bộ đếm cũ vẫn khớp sau khi deploy.
