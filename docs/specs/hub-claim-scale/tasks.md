---
id: hub-claim-scale
lát: hub-claim-scale
cr: CR-114
làn: đầy đủ (khoá/đồng thời claim)
migration: không
phụ thuộc:
---
## Plan (ngắn)
Claim job Agent Hub không còn xếp hàng sau một khoá toàn cục `K_CLAIM` (`hashtext('hub.jobs.claim')`):
khoá theo **provider** (2 khoá `hub.jobs.claim` + `hashtext(provider_key)`) và, khi job thuộc provider
`subscription` của tenant có giới hạn, thêm khoá **tenant** (`hub.jobs.claim.tenant` + `hashtext(tenant_id)`),
rồi kiểm lại số `running` của tenant dưới khoá. Pool DB đổi kích thước qua env; pgbouncer tuỳ chọn.

## Làm
1. Test đồng thời TRƯỚC (`tests/acceptance/claim_scale_int_test.py`): N claimer song song qua `claim_one`
   thật, 3 provider × 2 tenant, lấy mẫu → `running` theo provider ≤ `max_concurrency`, tenant ≤
   `max_concurrent_sub` (tính trên mọi provider subscription), không job claim 2 lần (`attempts=1`).
   Thêm ca cooldown: provider `cooldown` chưa hết hạn ⇒ 0 claim.
2. `jobs_sql.claim_one`: (a) PEEK = câu claim không khoá hàng → provider của job tốt nhất (giữ thứ tự
   priority toàn cục); (b) transaction: `K_CLAIM(provider)` → câu claim cũ giới hạn 1 provider
   `FOR UPDATE SKIP LOCKED`; (c) provider subscription + tenant có giới hạn ⇒ `K_CLAIM_TENANT` rồi
   `TENANT_OK` (câu mới, thấy commit của claimer khác); trượt ⇒ rollback, thử lại. Provider trả rỗng bị
   loại khỏi lượt PEEK sau ⇒ vòng lặp có chặn.
3. `finish_sql` / `probe_sql`: `K_CLAIM` → `K_CLAIM` theo provider của job/probe (vẫn chặn claim provider
   đó tới khi `provider_state` đổi). Thứ tự khoá: provider → hàng `jobs` → tenant → `provider_state`.
4. Perf: `claim_scale_int_test.py::perf` đo claim/s trước (khoá toàn cục cũ, giữ trong test làm mốc) vs
   sau, ngưỡng sau ≥ 1.3× trước với 4 provider / 16 claimer.
5. Pool: `AGENT_RT_DB_POOL_MAX` (mặc định 4) cho asyncpg; hub-api `connectDb` đọc `HUB_DB_POOL_MAX`
   (mặc định 10). `deploy/prod-sohoptac2` thêm service `pgbouncer` profile `pgbouncer` (TẮT mặc định) +
   ghi chú prepared statement / LISTEN.

## Không làm / Chạm
Không migration (0081 không dùng). Điều kiện claim giữ nguyên (cách đếm đổi sang CTE — xem Quyết định). Không deploy.
Chạm: `apps/agent-runtime/src/agent_runtime/db/{jobs_sql,finish_sql,probe_sql,pool}.py`,
`apply_sql.py`, `config.py`, `queue/runtime.py`, `tests/acceptance/{claim_scale_int_test,probe_int_test}.py`, hub-api `config/env.ts` + `server.ts`,
`deploy/prod-sohoptac2`.

## Test tối thiểu
- `tests/acceptance/claim_scale_int_test.py` (mới), `claim_int_test.py`, `probe_int_test.py` P37,
  `tests/runtime/probe_error_lock_int_test.py`, unit `queue/test_probe_loop.py`, `test_queue.py`.

## Quyết định trong lúc làm
- Khoá provider dạng 2 khoá ⇒ khác không gian với `K_CLAIM` 1 khoá cũ và `hub.runs.user`/`hub.attach.tenant`.
- PEEK không `SKIP LOCKED` (không hợp lệ khi không `FOR UPDATE`) — chỉ để chọn provider; an toàn do câu
  thứ hai chạy dưới khoá.
- Đo mốc cũ thấy câu claim nguyên văn O(queued × running) (subquery đếm mỗi hàng ứng viên, 28.8 ms với
  200 queued/200 running khi kế hoạch xấu) ⇒ đổi sang CTE `pr`/`tr` `MATERIALIZED` đếm một lần, `payload`
  lấy qua `CLAIM_UPDATE … RETURNING payload` (không kéo cột rộng trước khi sort). Điều kiện giữ nguyên.
- Slot sandbox đếm theo worker: claim tự-sửa và claim `source.apply` (`apply_sql`) cùng giữ
  `K_CLAIM_SANDBOX(worker)` trước (trước đây claim Áp không giữ `K_CLAIM` ⇒ có cửa sổ vượt slot).
- Thứ tự khoá: `K_CLAIM_SANDBOX(worker)` → `K_CLAIM(provider)` → hàng `jobs` → `K_CLAIM_TENANT` →
  `provider_state`; "Kết thúc"/probe chỉ giữ `K_CLAIM(provider)` ⇒ không chu trình.
- Số đo (local Windows PG16, 400 job, 4 provider, 16 claimer, chỉ claim): khoá toàn cục + câu cũ 318–373
  claim/s (33–38 claim/s ở lần chạy đầu khi kế hoạch chưa ổn định), khoá toàn cục + câu mới 252–289,
  khoá theo provider + câu mới 507–553 claim/s (1.5–1.6×; ngưỡng test ≥ 1.3×).
- pgbouncer: thêm service sau profile, chưa trỏ DSN nào vào (LISTEN + khoá probe mức phiên phải đi thẳng
  `pg`) — `deploy/prod-sohoptac2/README-pgbouncer.md`.

- Kiểm trên Linux (máy evotest, container `uv:python3.12` + PG16/Redis tạm, dọn sau): int claim_scale + claim + probe (gồm P37) + probe_error_lock + pc2/apply = 42 passed; unit queue/db/config 87 passed. `plan-db` H1 §5.4 đã cập nhật.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: chỉ đổi cách khoá claim để nhiều worker claim song song; bất biến giới hạn provider/tenant/sandbox/cooldown giữ nguyên, docs/current chưa mô tả Agent Hub)

## Việc còn lại
- Tách DSN LISTEN riêng (hub-api `db.listen`, Runtime `connect_listen`) trước khi trỏ pool qua pgbouncer.
