# CR-095 · Review cuối đợt + security · phần B (gói hợp đồng, nhập dữ liệu)

Phạm vi: `05ccd514..a164e2d9` trên `platform/gd0`: M3, W1, W1b, I1, F1, HD78 (thêm vào giữa lượt), migration contracts 0009–0015, hub 0042,
admin 0014, knowledge 0003–0004.
Ngày: 2026-10-20. Chỉ đọc mã; file này là thay đổi duy nhất. Bản này thay bản một phần ở commit 47ab968f.

Cách làm: bốn reviewer con đọc sâu M3 (duyệt), M3 (worker/AI/PDF), W1/W1b và I1; F1, migration, phần chạy evotest và HD78 tự kiểm.
Phần HD78 chỉ ở mức an ninh và tiền (chống SSRF, `pyRound`, RLS của 0015, JIT), chưa đọc sâu như các lát kia: mục HD78 bên dưới ghi rõ còn thiếu gì.

## Đã kiểm

- **Thứ tự `when` trong journal:** tăng nghiêm ngặt ở mọi journal được chạm (contracts 0008→0014, knowledge 0002→0004, hub 0041→0042,
  admin 0013→0014, hub-dev 0000→0001). Mọi entry mới đều lớn hơn entry cuối có trước phạm vi ⇒ trên DB đang chạy, migrator Drizzle sẽ áp chúng.
  Lịch sử sau rebase là tuyến tính: từ commit đầu tiên của M3, journal đã ghi `0011_m3_approvals` (M1b giữ `0010`).
- **Migrate trên DB rỗng + int có mục tiêu (evotest, 88f70a73):** `test:int:par` chạy 18 file (HD3 ×6, M3D ×3, W1 ×2, W1B ×2, I1, M3 db-schema,
  ADM-NFR-06 migrate, db migrate, db migrate-hub): **135 pass, 4 fail**. Cả 4 lỗi nằm trong `packages/db/src/migrate-hub.int.test.ts` (phát hiện #1).
  Mẫu DB test dựng bằng cách migrate từ DB rỗng, nên đường fresh-migrate cho cả bốn bộ migration đều xanh. Hub 0042 áp được lên DB stub đã có
  một dòng `usage_logs` cũ (được hub: 41).
- **evotest lần 2 (HEAD a164e2d9, gồm HD78):** 25 file (HD3, HD7, HD8, W1, W1B, I1, M3D, rls-packs, migrate main + ADM-NFR-06):
  **343 pass, 0 fail**. Journal contracts 0014 → `0015_hd8_partners` (1793836800000) vẫn tăng nghiêm ngặt; DB rỗng migrate tới 0015 xanh.
  (Lần này không chạy migrate-hub nên #1 vẫn còn.)
- **RLS của bảng mới (mức migration):** `contracts.legacy_records` → `packs.secure_table` + REVOKE UPDATE/DELETE; 6 bảng đồ thị knowledge →
  `packs.secure_table`; bảng admin 0014 → ENABLE RLS kèm policy, closure chỉ ghi qua hàm SECURITY DEFINER có ghim `search_path`, quyền thực thi
  đã REVOKE khỏi PUBLIC. Knowledge 0004: các role `knowledge_search` và `knowledge_api` là NOLOGIN/NOBYPASSRLS, hàm definer ghim `search_path`.
- **F1 (module đóng băng):** khi cờ off, hub-api không mount `/dlc`, `/rooms*`, `/sources`, `/studio/api/kh/connections*` và route công khai của
  quy trình; admin-api không mount workflows/commands/export/import/workflow-tools. Engine và vòng nền vẫn chạy. contracts-web không gọi route
  nào trong số đó (trợ lý dùng `/conversations`, `/runs`). Trong chat-web, `probeEngine` coi 404 là "off" nên `!key` hạ cấp êm.
  mgmt-import là CLI, không dùng `/admin/import`. Không thấy chức năng đang hoạt động nào phụ thuộc route đóng băng.
- **Route W1 (kiểm thử chọn mẫu đầu vào):** `sourcing.routes.ts`, `mywork.routes.ts`: guard chạy trước khi đọc thân; uuid, dòng và thân/query
  strict đều kiểm bằng zod ⇒ đầu vào sai trả 400/404/422, không trả 500.

## Phát hiện

| # | Mức | Lát | Vị trí | Vấn đề | Sửa |
|---|-----|-----|--------|--------|-----|
| 1 | Trung | R1 (migration hub-dev) | `packages/db/src/migrate-hub.int.test.ts:121`, `:144` | Hub-dev đã có `0001_knowledge_login_dev` nhưng test vẫn chờ `hubDev: 1` ⇒ 4 test đỏ trên evotest. Các assert sau dòng 121 (cột usage_logs, unique job_id trên DB stub, có chạm tới thay đổi hub 0042 của M3) **không chạy tới**, nên đường migrate trên DB hiện có của hub 0042 chưa được test này chứng minh. | Đổi số chờ hubDev thành 2 (dòng 121) và kiểm lại số ở lần chạy thứ hai (dòng 144); chạy lại file trên evotest. |
| 2 | Trung | M3 | `tools/scripts/src/m3-close-contract-runs.ts:29` | Script chỉ đặt `expires_at = now()` rồi trông vào vòng hết hạn của engine để đóng run. `HUB_PROCESS_ENGINE` mặc định `off` và không có trong `.env.production.example` ⇒ ở production các run vẫn ở trạng thái active mãi. | Ghi rõ trong runbook là phải bật engine cho một lượt quét, hoặc để script tự đóng run (status/stage/task) trong cùng tx. |
| 3 | Trung | M3 | `tools/scripts/src/m3-close-contract-runs.ts:47-50` | `--apply` vẫn đóng cả run `unmapped` (không có hàng `contracts.approvals` tương ứng) ⇒ duyệt dở dang mất mà không cảnh báo. | Khi `unmapped > 0` thì dừng, trừ khi có `--force`, và in danh sách id. |
| 5 | Cao | M3 | `apps/hub-api/src/modules/packs/contracts/adapters/extract-stream.redis.ts:155-157,205` | `loop()` lỗi lúc khởi động (Redis down, `XGROUP CREATE`, query DB) chỉ ghi log `contract-extract-worker-stopped` rồi không bao giờ chạy lại ⇒ instance ngừng nhận job tới lần restart. | Chạy lại `loop()` với backoff, dừng theo `signal`. |
| 6 | Cao | M3 | `extract-stream.redis.ts:78-89,147-150,169` | `groupReady` được cache vĩnh viễn. Redis mất group (restart không AOF, FLUSH) ⇒ XREADGROUP trả NOGROUP mãi, lỗi reclaim bị nuốt (`.catch(()=>0)`) ⇒ worker chết im lặng. | Khi gặp NOGROUP: đặt `groupReady = null`, gọi lại `ensureGroup`, ghi warn. |
| 7 | Cao | M3 | `extraction.mount.ts:125`, `application/approval-sweep.ts:29`, `adapters/approval-sweep.repo.ts:17` | STALE 15' tính từ `updated_at` ⇒ HĐ còn xếp hàng (2 job/instance, gọi AI tính bằng phút) bị `extract_failed STALE` trước khi worker tới lượt. Ngoài ra `CONTRACTS_EXTRACT_TIMEOUT_S` tối đa 3600 ⇒ `claimIdleMs` (≈61') lớn hơn STALE. | Tính STALE theo `claimIdleMs` + thời gian chờ hàng tối đa, hoặc cập nhật `updated_at` khi lấy job; đặt trần cho env. |
| 8 | Cao | W1b | `adapters/followups.repo.ts:47` + `adapters/followup-send.repo.ts:38` | Tiêu đề hẹn nhắc dài tới 300 ký tự, nhưng CHECK của `hub.notifications.title` ≤ 200 (`migrations-hub/0040_n3_notify.sql:25`) ⇒ `notify.enqueue` lỗi, cả lô của tenant rollback. Claim sắp theo `due_at` nên hàng xấu luôn đứng đầu ⇒ **chặn vĩnh viễn** mọi hẹn nhắc của tenant đó. | Gửi `left(title,200)` khi enqueue (hoặc giới hạn 200 ngay lúc tạo); thêm test với tiêu đề 250 ký tự. |
| 9 | Cao | W1 (security) | `application/sourcing.usecase.ts:57-63,79-80`, `domain/sourcing.rules.ts:84-88,131-139` | Dòng giá dựng từ **mọi** HĐ của tenant (cache chung), sau đó mới lọc theo `contract_id ∈ visible` ⇒ **lộ dữ liệu qua luật thấy M1b.** (A) Thấy phụ lục mà không thấy HĐ cha ⇒ lộ tên bên mua/bán, chiều và sản phẩm của HĐ cha. (B) Thấy HĐ cha mà không thấy phụ lục ⇒ ngày hiệu lực của phụ lục ẩn vẫn làm dòng cha thành `current=false` ⇒ lộ sự tồn tại của phụ lục. | Lọc HĐ thô theo tập thấy được **trước** `priceLines` (cache HĐ thô thay vì dòng đã dựng); thêm test int với phụ lục khác owner ở chế độ org. |
| 10 | Trung | M3 | `extract-stream.redis.ts:91-123` | Không đếm số lần giao, không có dead-letter ⇒ entry làm crash hoặc OOM process bị XAUTOCLAIM nhặt lại mãi, lần lượt làm sập từng instance. | Đọc delivery count (`XPENDING`); quá N lần thì ghi `extract_failed` rồi ACK, hoặc chuyển sang DLQ. |
| 11 | Trung | M3 | `application/approval-flow.ts:62` | Tx commit xong mới XADD; XADD lỗi ⇒ 500 (không có ánh xạ Redis→503), còn retry thì nhận 409 `EXTRACT_BUSY` tới khi STALE. | Bắt lỗi enqueue: ghi log và vẫn trả 202 (STALE là lưới an toàn), hoặc ánh xạ thành 503. |
| 12 | Trung | M3 | `application/extract-job.usecase.ts:23` | `afterExtraction` chạy tx riêng; nếu lỗi thì entry vẫn bị ACK ⇒ approval kẹt ở `extracting` trong khi HĐ đã sang trạng thái khác ⇒ trích lại trả 409 mãi. | Sweep đóng thêm approval `extracting` có HĐ không còn `extracting`, hoặc ném lại lỗi để entry không bị ACK. |
| 13 | Trung | M3 | `apps/hub-api/src/lib/ai-client/ai-client.ts:98-110` | Trần token theo kiểu kiểm-rồi-gọi ⇒ N lời gọi đồng thời của một tenant đều qua cửa, vượt trần tới ≈ N×(input+32k). Không có test cho tình huống đua này. | Giữ chỗ token nguyên tử trước khi gọi (Redis INCRBY hoặc hàng giữ chỗ trong Postgres), quyết toán sau; `maxTokens = min(32k, phần còn lại)`. |
| 14 | Trung | M3 | `ai-client.ts:111-116`, `anthropic.provider.ts:49-56` | Chỉ ghi dòng usage khi có `reply.usage` ⇒ abort, timeout, 5xx giữa stream không được ghi và không tính vào trần. | Luôn ghi một dòng (usage một phần lấy từ `message_delta` cuối, kèm mã ok/error). |
| 15 | Trung | W1 | `adapters/mywork.repo.ts:105-107` | Snooze một hẹn đã `done` trong khi đã có hẹn mở khác trên cùng subject ⇒ 23505 trên `followups_open_uq` ⇒ 500. | Thêm `status <> 'done'` (trả 404) hoặc xử lý conflict. |
| 16 | Trung | W1 | `packages/contracts/src/pack-contracts/followups.ts:13,21` | `subject_id: z.string()` nhận ký tự NUL ⇒ Postgres lỗi 22021 ⇒ 500. | Chặn NUL (hoặc regex bộ ký tự) ở cả hai schema. |
| 17 | Trung | W1 | `application/sourcing-cache.ts:31-44` | `inflight` khoá chỉ theo tenant ⇒ request mang fingerprint mới (vd ngay sau PUT của chính nó) nhập vào lượt nạp cũ ⇒ hỏng read-your-write, rồi dữ liệu cũ đó được lưu vào cache. | Khoá `inflight` theo `tenant|fp|ngày`, hoặc so `fp` sau khi await. |
| 18 | Trung | W1 (tiền) | `domain/sourcing.rules.ts:192-213,320` | `unit_price` (bigint) và `qty` (numeric) đi qua JS Number; `margin*qty`, tổng profit và `margin_pct` không làm tròn (qty lẻ ⇒ số lẻ thập phân), mất chính xác khi vượt 2^53. | Tính bằng NUMERIC trong SQL hoặc làm tròn về VND nguyên; chặn giá ≤ 10^15 như CKS. |
| 19 | Trung | W1 (perf) | `adapters/mywork.repo.ts:44`, `adapters/followups.repo.ts:28,31,36` | So `id::text = subject_id` ⇒ không dùng được PK index ⇒ quét toàn bảng của tenant ở mỗi lần tạo và mỗi hàng trong CTE `gf`. | So sánh dạng uuid có guard (`nullif(...)::uuid` + regex); chỉ chạy nhánh company khi `kind='company'`. |
| 20 | Cao | I1 | `apps/admin-api/src/modules/mgmt-import/application/import.usecase.ts:126-128,155` | Khoá checkpoint là `tid|bảng|chỉ số lô` (vị trí, không phải nội dung lô). Chết giữa `contracts.files` lô 1 ⇒ khi chạy tiếp, `moveFiles` bỏ file đã có nên phần còn lại dồn về lô 0, mà lô 0 đã đánh dấu xong ⇒ **không bao giờ ghi**. Hậu quả: FK `file_id` của `contracts` đỏ ở mọi lượt sau và file bị tải lên lại thành mồ côi. Đổi `--batch` hoặc thứ tự scroll cũng gây lệch như vậy. Không có test chạy tiếp (`statePath` luôn null). | Khoá lô theo hash id hàng (+ nguồn, cỡ lô), hoặc bỏ checkpoint (đã có ON CONFLICT DO NOTHING); thêm int test giết giữa lô rồi chạy lại với `--state`. |
| 21 | Cao | I1 | `domain/map-cks.rules.ts:90` | `lot_id` đặt bằng `ref2(...)` mà không kiểm lô đã được ánh xạ chưa; lô bị bỏ vì LOT_INCOMPLETE (`:39`) ⇒ vi phạm `cks_certificates_lot_fk` ⇒ cả lô chứng thư rollback, CLI exit 1 với dữ liệu nhập dở. | Giữ tập lô đã ánh xạ; thiếu thì đặt null kèm issue (như `replaces` ở `:271-277`). |
| 22 | Trung | I1 | `map-cks.rules.ts:94-95`, `adapters/target.sql.ts:117-130` | FK tự tham chiếu `replaces` chỉ được kiểm trong plan, không kiểm giữa các lô ⇒ B (thay A) ghi ở lô trước A thì lỗi. | Sắp chứng thư để A ghi trước B, hoặc ghi `replaces` bằng một lượt UPDATE thứ hai. |
| 23 | Trung | I1 | `target.sql.ts:175-188`, `map-ledger.rules.ts:69`, `map-cks.rules.ts:52,91,120,124` | Id HĐ vẫn được tính cho HĐ không được nhập; các cột này không có FK ⇒ tham chiếu treo mà không báo. | Thêm `where exists` (như `contract_reminders`), hoặc đặt null kèm issue CONTRACT_MISSING. |
| 24 | Trung | I1 (tiền) | `domain/reconcile.rules.ts:8-9`, `domain/values.rules.ts:61-66`, `map-cks.rules.ts:13` | Số tiền không nguyên hoặc > 2^53 thành 0 ở tổng nguồn và null ở tổng đích ⇒ `money_ok` vẫn true (trái D-I1-04). `cap()` đặt null cho số > 1e10 mà không ghi issue. Không có phép làm tròn hay tính lại VAT nào (tiền copy nguyên đồng) ⇒ chuyện parity làm tròn không áp dụng. | Tổng nguồn tính bằng parser độc lập (BigInt chuỗi số + đếm số không nguyên); `cap` phải ghi issue. |
| 25 | Trung | I1 (cách ly tenant) | `domain/map-knowledge.rules.ts:132-133` | REL có `evidence_chunk` nhưng chunk đó không được nhập ⇒ `evT` undefined ⇒ quan hệ được chép vào **mọi** tenant có đủ hai thực thể ⇒ quan hệ học từ tài liệu org A hiện ở tenant B. | Chỉ chép toàn tenant khi `ev` null; `ev` có nhưng không ánh xạ được ⇒ bỏ. |
| 26 | Trung | M3 | `adapters/approval.repo.ts:130-141` | Finalize tin cờ `level2Passed` do caller truyền vào; WHERE không kiểm `status='level2'` và `started_by <> by`. Hiện use case chỉ gọi dưới khoá hàng (phòng thủ chiều sâu). | Thêm `exists(... status='level2' and started_by <> $by)` + test bypass. |
| 27 | Trung | M3 | `adapters/approval.routes.ts:73` | Quota redo bị trừ **trước** khi kiểm người duyệt, bước mở và nguồn ⇒ ai có quyền write cũng đốt được 100 lượt/ngày của tenant. | Trừ quota sau `decide`, chỉ khi thật sự trích lại. |
| 28 | Trung | M3 | `application/approval.usecase.ts:114-145` | Redo không kiểm AI sẵn sàng; AI chưa cấu hình ⇒ enqueue no-op ⇒ HĐ bị STALE thành `extract_failed`, trong khi `/extract` trả 503. | Đưa `ready` vào deps, trả 503 AGENT_UNAVAILABLE trước tx. |
| 29 | Trung | M3 | `packages/contracts/src/pack-contracts/approval.ts:25` | Feedback nhận ký tự NUL ⇒ 22021 ⇒ 500 (cùng loại với #16). | Chặn hoặc lọc ký tự điều khiển. |
| 4 | Thấp | chung (migration) | các `_journal.json` | `when` được đặt tay ở tương lai (knowledge/hub-dev 1794900300000 ≈ 2026-11-17). Migration sinh bằng `drizzle-kit generate` trước ngày đó sẽ có `when` nhỏ hơn ⇒ **bị bỏ qua im lặng** trên DB đang chạy. | Thêm unit test kiểm `when` tăng nghiêm ngặt trong từng journal, hoặc ghi luật "when = max + 86400000" vào CONVENTIONS. |

Thấp (M3): XAUTOCLAIM nhặt lại cả entry đang chạy của chính instance ⇒ job dài hơn `claimIdleMs` chạy hai lần và trả tiền AI hai lần
(`extract-stream.redis.ts:108-123`); `reclaimOnce` không trừ số job đang chạy ⇒ chạy đồng thời tới 2×limit−1 (`:122`); `PDF_BUSY` và
`SOURCE_UNAVAILABLE` là lỗi tạm nhưng bị ghi thành `extract_failed` cuối (`run-extraction.usecase.ts:61`); trần token không tính token cache
(`0042_m3_ai_usage.sql:52`); lỗi race `contract-approval-open-raced` là `Error` thường ⇒ 500 (`approval-flow.ts:56`); PdfConverter không được
`close()` khi tắt (`packs.mount.ts:136`); test M3D chưa phủ poison ACK, Redis down ⇒ 503, phục hồi NOGROUP, đua trần token, usage khi lỗi.
#3 (đóng cả run unmapped) đã được reviewer M3 xác nhận độc lập.

Thấp (W1/W1b): vòng gửi không có backoff theo hàng (`followup-send.usecase.ts:64-71`); `sourcing_choices` chỉ có policy SELECT, INSERT/UPDATE
không có WITH CHECK theo luật thấy (`0013:24`); `itemExists` bỏ qua trạng thái HĐ ⇒ 422 thay vì 404 (`sourcing.repo.ts:78-82`); cache tối đa 16
tenant/instance (`sourcing-cache.ts:19`); khoá dedup theo phút ⇒ snooze trùng phút giờ hẹn gốc bị nuốt (`followup-send.repo.ts:42`).

Đã kiểm và ổn: XACK chạy sau commit DB; giao lại idempotent nhờ guard `extracting`/`version`; khoá AI chỉ lấy từ env, không ghi log; hàm của 0042
là DEFINER, ghim `search_path`, REVOKE khỏi PUBLIC; PDF (trần 20 MiB, đếm trang, timeout 30 s); fingerprint cache sourcing đúng giữa nhiều
instance; phân trang (page_size 1..100, thứ tự tất định); claim SKIP LOCKED, đánh dấu sent và enqueue trong một câu (không mất hoặc trùng khi
crash); `contracts_job` NOBYPASSRLS, SELECT theo cột; RLS của followups.

Luật HD3 (M3): **đủ cả và đều có test.** Ngưỡng 500M (≥) theo tenant, L1 = editor, L2 = owner. "Starter" là người mở luồng duyệt, không phải
gói Starter: người đó bị chặn ở L2 (STARTER_CANNOT_REVIEW). Sửa tiền mở lại duyệt trong cùng tx. Các 409 EXTRACT_BUSY, APPROVAL_NOT_OPEN,
CONTRACT_IN_APPROVAL có test, cộng chỉ mục `approvals_live_uq`. Finalize kiểm lại ngưỡng trong WHERE. Settings ghi audit trong một CTE.
Quota 100/ngày trả 429; Redis down khi kiểm quota trả 503. Ngưỡng ≤ 1e15 nhất quán giữa zod, CHECK và `APPROVAL_THRESHOLD_MAX`.

Bảng ánh xạ HD3 cũ→mới: không luật nào bị bỏ mà không có lý do. Các chỗ yếu đi:
- D3-06 (từ chối qua chat-web) bị bỏ, lý do: UI engine đã đóng băng.
- reverify `use_current` thành duyệt L2 thường, nên đường quyết định không chuẩn không còn được chạy.
- D3-13 mất event `approval_started` khi mở lại; `approval.ports.ts` ghi `open` phát event nhưng `reopenApproval` không phát ⇒ cần sửa doc hoặc code.

Thấp (M3, duyệt):
- `flowCreateManual` tạo HĐ và mở duyệt ở hai tx; lỗi ở giữa ⇒ HĐ không có duyệt và không phục hồi được (`approval-flow.ts:61-66`).
- PUT settings đọc–gộp–ghi qua nhiều tx ⇒ mất cập nhật khi đồng thời (`approval.routes.ts:85-91`).
- Settings và nhóm được đọc ngoài tx đang giữ khoá (`approval.usecase.ts:117-118`).
- `patchGuard.phase` mở kết nối thứ hai trong khi tx PATCH giữ khoá ⇒ nguy cơ cạn pool (`:162-167`).
- Thiếu test: hai POST approve song song, 400 cho uuid hoặc thân sai, XADD lỗi, sửa `vat_rate`/`vat_included` mở lại duyệt.

Thấp (I1):
- `partner_event_voids` join thiếu `mgmt_source` (`target.sql.ts:208`).
- Chạy lại sau khi nguồn đổi thì giữ hàng cũ mà không báo (đúng thiết kế đóng băng ghi, nhưng nên có số `changed`).
- Một tx mỗi file và quét O(n²) trong vòng lặp hàng (Luật 4c).
- Khoá tenant thay thế `<slug>-<hex>` không kiểm `used`.
- evotest-mgmt mount cache bun của evotest chính ở chế độ read-write (`deploy/evotest/mgmt/docker-compose.yml:114`) và để lại `out/` sau khi dọn.

Đã kiểm và ổn (I1): 0012 bật RLS FORCE; SQL tĩnh + `sql.identifier` trên union nên không có injection; uuid v5 theo RFC, có tính cả nguồn;
tiền lưu bigint; ánh xạ duyệt khớp 0011 (`migrated=true`); hash scrypt chỉ nằm trong bộ nhớ; profile evotest-mgmt không mở cổng, dùng tmpfs,
mật khẩu Neo4j sinh theo lượt; reader chỉ đọc nguồn.

## Verdict

## HD78 (kiểm mức an ninh và tiền)

- **Chống SSRF của kiểm link giá** (`adapters/link-check.http.ts`, `domain/link-check.rules.ts`): **ổn.** Chỉ cho http(s); tự phân giải DNS và
  **mọi** địa chỉ phải công khai; nối thẳng tới IP đã kiểm (SNI + Host = tên miền) nên DNS rebinding không lái được kết nối; kiểm lại ở mỗi lần
  chuyển hướng (≤ 5); trần 3 MB. Dạng IP thập phân/bát phân bị `new URL` chuẩn hoá trước. `[::ffff:127.0.0.1]` thành `::ffff:7f00:1` và rơi vào
  nhánh "không phải 2000::/3" ⇒ bị chặn. NAT64, 6to4, Teredo, ULA, link-local, 169.254/16 đều bị chặn.
  - **Thấp:** `timeout` của `http.request` là thời gian **rảnh** của socket, không phải tổng thời gian ⇒ trang nhỏ giọt giữ request lâu hơn 15 s;
    `lookup` không có timeout; không có giới hạn tần suất theo tenant cho việc máy chủ mở link. Sửa: AbortSignal tổng 15 s, timeout cho DNS,
    quota theo tenant.
- **`pyRound`** (`cks/domain/prices.rules.ts:57-71`): đúng ngữ nghĩa `round()` của Python. Hàm khai triển thập phân **chính xác** của số float
  (`toFixed(60)`), rồi làm tròn nửa-về-chẵn chỉ khi phần dư đúng bằng `50…0` ⇒ 2.675 → 2.67 khớp Python. Tiền lưu bigint đồng.
- **Migration 0015:** cả 6 bảng mới đều `packs.secure_table` (RLS FORCE theo tenant); lịch sử và ảnh chụp điểm REVOKE UPDATE/DELETE;
  `user_label` REVOKE khỏi PUBLIC. Các bảng mới **không** có policy luật thấy M1 (chỉ cách ly tenant). Theo commit, số đối tác đọc dưới RLS của
  người dùng; chưa kiểm `score_snapshots` có được tính trên HĐ người xem không thấy hay không. **Còn mở**: reviewer HD78 cần xác nhận.
- **JIT tắt trong tx gói** (`packages/db/src/pack-scope.ts`): `set_config('jit','off', true)` là cấu hình **cục bộ theo tx**, nằm trong cùng câu
  với role/tenant ⇒ không lọt sang kết nối khác của pool, không thêm câu SQL. Không thấy tác dụng phụ.
- **Chưa kiểm** (cần thêm một lượt đọc): parity điểm SQL (aggregate + scoreAgg) = TS = mgmt-app và độ phủ của test parity ngẫu nhiên; quyền sửa
  cấu hình chấm điểm và audit; xác thực đầu vào của `/partners`, `/scoring`, `/prices`, `/companies` (NUL, số lớn).

Đếm: Chặn 0 · Cao 7 · Trung 20 · Thấp 1 trong bảng, cộng các mục Thấp bên dưới bảng (M3 ×12, W1/W1b ×5, I1 ×5, HD78 ×1).

**CHANGES_REQUESTED.** Lý do: 7 lỗi Cao (M3 #5–#7, W1b #8, W1 #9, I1 #20–#21), migrate-hub int đỏ (#1), script đóng run không an toàn cho
cutover (#2–#3).
**Security: UNSAFE.** #9 lộ dữ liệu vượt luật thấy M1b qua `/sourcing`; #25 quan hệ tri thức chép sang tenant khác khi nhập; #13 vượt trần chi
phí AI theo tenant. Hết các lỗi này (và HD78 kiểm xong phần còn mở) thì chạy lại lượt security.
