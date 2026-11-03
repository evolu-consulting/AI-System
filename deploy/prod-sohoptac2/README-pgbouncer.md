# pgbouncer (tuỳ chọn, TẮT mặc định) — CR-114 hub-claim-scale

Service `pgbouncer` trong `docker-compose.yml` nằm sau profile `pgbouncer`: `docker compose up -d` KHÔNG
chạy nó, và hiện **chưa service nào trỏ DSN vào nó**. Bật chỉ khi số kết nối tới `pg` thành nút thắt
(nhiều instance hub-api / nhiều worker Runtime). Trước khi bật: kiểm tag image `edoburu/pgbouncer` còn
tồn tại và tạo `./pgbouncer/userlist.txt` (600) với `"<user>" "SCRAM-SHA-256$..."` cho từng role sẽ đi
qua bouncer (lấy từ `pg_authid.rolpassword`).

```
docker compose --profile pgbouncer up -d pgbouncer
```

## Cỡ pool (không cần pgbouncer)

| Biến | Dịch vụ | Mặc định |
|---|---|---|
| `HUB_DB_POOL_MAX` | hub-api `connectDb` | 10 |
| `AGENT_RT_DB_POOL_MAX` | agent-runtime pool asyncpg (claim/heartbeat/kết thúc) | 4 |

Tổng kết nối ≈ Σ pool + 1 LISTEN mỗi instance; giữ dưới `max_connections=200` của `pg`.

## Bẫy transaction mode — đọc trước khi đổi DSN

1. **LISTEN/NOTIFY không qua được pgbouncer transaction mode.** Kết nối LISTEN phải trỏ thẳng `pg:5432`:
   - agent-runtime: `connect_listen` dùng chung `AGENT_RT_DATABASE_URL` với pool ⇒ **giữ Runtime đi thẳng
     `pg`** (cần thêm DSN LISTEN riêng nếu muốn pool Runtime qua bouncer — chưa làm).
   - hub-api: `config.service` gọi `db.listen(...)` trên cùng `HUB_DATABASE_URL` ⇒ chỉ đổi DSN hub-api
     sang bouncer sau khi tách DSN LISTEN riêng (chưa làm).
2. **Khoá advisory mức phiên** (`pg_try_advisory_lock('hub.provider.probe', …)` của probe Runtime) gắn với
   kết nối server — transaction mode có thể trả kết nối cho client khác ⇒ Runtime phải đi thẳng `pg`.
   Khoá `pg_advisory_xact_lock` (claim theo provider/tenant, `hub.runs.user`, `hub.attach.tenant`) an toàn.
3. **Prepared statement:** asyncpg và postgres.js (`prepare: true`) dùng prepared statement mức giao thức;
   cần pgbouncer ≥ 1.21 với `max_prepared_statements > 0` (đặt qua `PGBOUNCER_MAX_PREPARED`, mặc định 200),
   nếu không sẽ gặp `prepared statement "…" does not exist`. Với bouncer cũ: tắt prepare phía client.
4. `SET`/`SET ROLE` mức phiên không giữ qua transaction — trước khi chuyển một dịch vụ, rà mọi chỗ đặt
   scope/role (vd `withHubScope`, `packages/db`) chỉ dùng dạng `SET LOCAL`/`set_config(..., true)` trong
   transaction (chưa rà trong CR-114).
