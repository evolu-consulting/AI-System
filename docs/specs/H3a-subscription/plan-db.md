# Plan · H3a · DB (migration + SQL nguyên văn)

Phụ lục của [`plan.md`](plan.md) §3, §5. SQL Runtime dùng tham số asyncpg (`$n`). Nền: H1 `plan-db` §5.4 ("Provider OK/lỗi/hỏng", "Kết thúc"). Câu H1 không ghi lại ở đây thì **giữ nguyên**.

## 1. Migration `packages/db/migrations-hub/0008_h3a_provider_state.sql` (D1)
Viết tay, idempotent như `0006` (ADD COLUMN IF NOT EXISTS; CHECK qua `DO $$ … IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = …)`). Chỉ thêm cột NULL + CHECK — không mất dữ liệu, không đổi RLS/GRANT (`agent_runtime`: `SELECT, INSERT, UPDATE` cấp ở mức bảng trong `0000` ⇒ phủ cột mới; `hub_rw` như cũ).

```sql
-- WRK-FR-22 · WRK-FR-15 · H3a-R05 (plan-db H3a §1): cột probe + tín hiệu quota của provider subscription.
ALTER TABLE hub.provider_state
  ADD COLUMN IF NOT EXISTS last_probe_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_ok_at timestamptz,
  ADD COLUMN IF NOT EXISTS rate_limit_type text,
  ADD COLUMN IF NOT EXISTS utilization real,
  ADD COLUMN IF NOT EXISTS warn_at timestamptz,
  ADD COLUMN IF NOT EXISTS warn_resets_at timestamptz;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_state_rate_limit_type_check') THEN
    ALTER TABLE hub.provider_state ADD CONSTRAINT provider_state_rate_limit_type_check
      CHECK (rate_limit_type IS NULL OR rate_limit_type ~ '^[a-z0-9_]{1,40}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'provider_state_utilization_check') THEN
    ALTER TABLE hub.provider_state ADD CONSTRAINT provider_state_utilization_check
      CHECK (utilization IS NULL OR (utilization >= 0 AND utilization <= 1));
  END IF;
END $$;
```
`meta/_journal.json`: `{"idx": 8, "version": "7", "when": <ms>, "tag": "0008_h3a_provider_state", "breakpoints": true}` (mẫu `0007`). `packages/db/src/schema/hub.ts` `providerState` + `lastProbeAt: ts("last_probe_at")`, `lastOkAt`, `rateLimitType: text`, `utilization: real`, `warnAt`, `warnResetsAt`. Test `packages/db/src/hub-h3a.int.test.ts`: cột có, NULL mặc định, CHECK chặn `rate_limit_type='Five-Hour'`/`utilization=1.5`, `agent_runtime` UPDATE được cột mới, chạy lại migration không lỗi.

**Giá trị từ Runtime trước khi ghi** (`quota_rules.clean_type`/`clean_util`, `plan-runtime` §3): `rate_limit_type` không khớp regex ⇒ NULL; `utilization` ngoài [0, 1] hoặc không hữu hạn ⇒ NULL — không bao giờ để CHECK làm rollback transaction "Kết thúc".

## 2. SQL Runtime — sửa câu H1 (`db/provider_state_sql.py`)
| Tên | SQL | Thay cho |
|---|---|---|
| `PROVIDER_OK` | `INSERT INTO hub.provider_state (provider_key, last_ok_at) VALUES ($1, now()) ON CONFLICT (provider_key) DO UPDATE SET last_ok_at = now(), consecutive_errors = 0, updated_at = CASE WHEN hub.provider_state.consecutive_errors <> 0 THEN now() ELSE hub.provider_state.updated_at END;` | H1 `UPDATE … WHERE consecutive_errors <> 0` (R12 cần `last_ok_at` mỗi job thành công; **không đổi `status`** — chỉ probe đưa về `ok`, PL15) |
| `MARK_BROKEN` | `INSERT INTO hub.provider_state (provider_key, status, cooldown_until, last_error, rate_limit_type, utilization, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now()) ON CONFLICT (provider_key) DO UPDATE SET status = EXCLUDED.status, cooldown_until = EXCLUDED.cooldown_until, last_error = EXCLUDED.last_error, rate_limit_type = coalesce(EXCLUDED.rate_limit_type, hub.provider_state.rate_limit_type), utilization = coalesce(EXCLUDED.utilization, hub.provider_state.utilization), updated_at = now();` | H1 4 tham số (+ `$5` type, `$6` util — R02) |
| `ENSURE_ROW` | `INSERT INTO hub.provider_state (provider_key) VALUES ($1) ON CONFLICT (provider_key) DO NOTHING;` | mới (trước `NOTE_WARNING`) |
| `NOTE_WARNING` | `WITH old AS (SELECT warn_resets_at FROM hub.provider_state WHERE provider_key = $1 FOR UPDATE) UPDATE hub.provider_state s SET utilization = $2, rate_limit_type = coalesce($3, s.rate_limit_type), warn_at = now(), warn_resets_at = $4 FROM old WHERE s.provider_key = $1 RETURNING old.warn_resets_at IS DISTINCT FROM $4 AS first;` | mới (R03) — `first` ⇒ log `provider.quota_warning`; không đổi `status`/`updated_at` |

`$4` của `NOTE_WARNING` = `quota_rules.warn_window(resets_at, now)` (giây Unix `resets_at` hợp lệ R02 ⇒ thời điểm đó; vắng/ngoài biên ⇒ `date_trunc('hour', now)` phía Python, UTC) ⇒ một log mỗi cửa sổ, vắng cửa sổ ⇒ tối đa một log/giờ.

Transaction "Kết thúc" (`db/finish_sql.py` `_body`, thứ tự H1 giữ): … `cli_sessions` → `PROVIDER_OK` | `PROVIDER_ERROR` → `MARK_BROKEN` (nếu hỏng) → `ENSURE_ROW` + `NOTE_WARNING` (nếu `FinishTx.warning` ≠ None). Mọi câu provider cùng một hàng ⇒ không thêm thứ tự khoá.

## 3. SQL probe (`db/probe_sql.py`, mới)
```sql
-- PROBE_TARGETS ($1 text[] = provider claim được của Runtime, trừ HTTP): một lần mỗi nhịp; `db_now` dùng cho mọi so sánh giờ (không lệch đồng hồ giữa các Runtime).
SELECT p.key, s.status, s.cooldown_until, s.last_probe_at, s.last_ok_at, s.consecutive_errors, s.updated_at, now() AS db_now
FROM hub.providers p LEFT JOIN hub.provider_state s ON s.provider_key = p.key
WHERE p.key = ANY($1::text[]) AND p.kind = 'subscription' AND p.enabled
ORDER BY p.key;

-- PROBE_TRY_LOCK / PROBE_UNLOCK (khoá phiên, R11)
SELECT pg_try_advisory_lock(hashtext('hub.provider.probe'), hashtext($1)) AS ok;
SELECT pg_advisory_unlock(hashtext('hub.provider.probe'), hashtext($1));

-- PROBE_SNAPSHOT: đọc lại sau khi có khoá (khử lượt trùng giữa Runtime + mốc rào R15); cùng cột như PROBE_TARGETS, WHERE p.key = $1.

-- PROBE_HEALTHY (kết quả ok, snapshot khoẻ/không hàng): một UPSERT, không K_CLAIM, không đổi status/consecutive_errors/updated_at (PL4).
INSERT INTO hub.provider_state (provider_key, last_probe_at, last_ok_at, rate_limit_type, utilization)
VALUES ($1, now(), now(), $2, $3)
ON CONFLICT (provider_key) DO UPDATE SET last_probe_at = now(), last_ok_at = now(),
  rate_limit_type = coalesce(EXCLUDED.rate_limit_type, hub.provider_state.rate_limit_type),
  utilization = coalesce(EXCLUDED.utilization, hub.provider_state.utilization)
WHERE hub.provider_state.status IN ('ok', 'busy')
RETURNING 1;

-- PROBE_RECOVER (kết quả ok, snapshot logged_out/error/cooldown đã hết hạn): về ok, rào updated_at.
UPDATE hub.provider_state SET status = 'ok', consecutive_errors = 0, cooldown_until = NULL,
  last_probe_at = now(), last_ok_at = now(),
  rate_limit_type = coalesce($3, rate_limit_type), utilization = coalesce($4, utilization), updated_at = now()
WHERE provider_key = $1 AND updated_at = $2 AND status <> 'ok'
RETURNING 1;

-- PROBE_MARK_BROKEN (trong transaction có K_CLAIM, sau FAIL_QUEUED): như MARK_BROKEN + last_probe_at + rào ($7 = updated_at snapshot, NULL khi chưa có hàng).
INSERT INTO hub.provider_state (provider_key, status, cooldown_until, last_error, rate_limit_type, utilization, last_probe_at, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, now(), now())
ON CONFLICT (provider_key) DO UPDATE SET status = EXCLUDED.status, cooldown_until = EXCLUDED.cooldown_until,
  last_error = EXCLUDED.last_error,
  rate_limit_type = coalesce(EXCLUDED.rate_limit_type, hub.provider_state.rate_limit_type),
  utilization = coalesce(EXCLUDED.utilization, hub.provider_state.utilization),
  last_probe_at = now(), updated_at = now()
WHERE hub.provider_state.updated_at IS NOT DISTINCT FROM $7
RETURNING 1;

-- PROBE_ERROR (lỗi probe: timeout, CLI không chạy, parse sai): đếm như H1 PROVIDER_ERROR + last_probe_at.
INSERT INTO hub.provider_state (provider_key, consecutive_errors, last_error, last_probe_at, updated_at)
VALUES ($1, 1, $2, now(), now())
ON CONFLICT (provider_key) DO UPDATE SET consecutive_errors = hub.provider_state.consecutive_errors + 1,
  last_error = EXCLUDED.last_error, last_probe_at = now(), updated_at = now()
RETURNING consecutive_errors, status;

-- PROBE_SEEN (kết quả cùng loại hỏng với snapshot, vd logged_out → logged_out): chỉ ghi mốc.
UPDATE hub.provider_state SET last_probe_at = now() WHERE provider_key = $1;
```

## 4. Transaction áp kết quả probe (`db/probe_sql.py` `apply_probe(conn, key, snap, result) -> Applied | None`)
`Applied{from_status, to_status, queued_failed: list[QueuedFail]}`; `None` = bị rào (log `probe.stale`, không ghi gì). Quyết định nhánh: `quota_rules.probe_transition(snap, result)` (`plan-runtime` §3).

| Nhánh | Câu (thứ tự) | Khoá |
|---|---|---|
| `healthy` | `PROBE_HEALTHY` (0 hàng ⇒ `None`) | hàng `provider_state` |
| `recover` | `PROBE_RECOVER` (0 hàng ⇒ `None`) | hàng `provider_state` |
| `seen` | `PROBE_SEEN` | hàng `provider_state` |
| `broken(b)` | transaction: `K_CLAIM` → `FAIL_QUEUED($1, b.reason)` → `PROBE_MARK_BROKEN` (0 hàng ⇒ raise ⇒ ROLLBACK ⇒ `None`) | `K_CLAIM → jobs → provider_state` |
| `error` | transaction: nếu `snap.status ∈ {ok, busy, NULL}` ∧ `snap.consecutive_errors + 1 ≥ ERROR_THRESHOLD`: `K_CLAIM` → đọc lại `ERRORS_NOW` dưới khoá → ≥ ngưỡng ⇒ như `broken(Broken("error", …))`; ngược lại `PROBE_ERROR` | như H1 "Kết thúc" lỗi |

Sau commit: XADD `job.failed` cho `queued_failed` (`outcome.queued_failure`, như `runner.py:121–123`) — **ngoài** transaction (R2 H1). Không ghi `usage_logs` (R17).

## 5. Không đổi
`CLAIM_SELECT` (điều kiện provider H1 giữ), `FAIL_QUEUED`, `PROVIDER_ERROR`, `ERRORS_NOW`, `K_CLAIM`. `RESET_PROVIDERS` chỉ còn dùng khi `AGENT_RT_PROBE_S=0` (PL2).
