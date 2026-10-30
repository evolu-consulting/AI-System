---
id: ops-core
lát: ops-core
cr: CR-104
làn: đầy đủ (trạng thái/idempotency/quyền)
migration: hub 0065 (trước là 0064, đổi số sau sự cố 2026-10-30)
phụ thuộc:
---
## Plan (ngắn)
Phần lõi O1 của `docs/specs/ops-watch` (CR-104): bảng + cấu hình + registry check + lượt kiểm idempotent nhiều instance + chuông
platform_admin + route `/ops/*`. Check thật (O2), UI (O3), script host (O4) làm sau.

## Làm
- [x] Migration hub `0065_ops_watch.sql` (trước `0064_ops_watch`; journal `when` 1798950000000, idx 63): `hub.ops_settings` (1 dòng jsonb + `last_round_at`/`last_manual_at`),
  `hub.ops_checks`, `hub.ops_events`; không tenant_id, không RLS (như `kh_connections`), chỉ `hub_rw`; hàm DEFINER `notify.enqueue_ops`.
- [x] Contract `@ai/contracts/hub-admin` `ops.ts`: `OpsStatus`, `OpsCheckKey` (8), `OPS_CHECK_META` (đơn vị/khoảng/thứ tự ngưỡng),
  `OpsSettingsSchema`, `OPS_DEFAULT_SETTINGS`, `opsSettingsFrom`, phản hồi status/settings, `OPS_ERRORS` (422/429).
- [x] `apps/hub-api/src/modules/ops/`: `OpsCheck` registry (mẫu `db_redis`), `runChecksOnce`/`runChecksNow`, repo SQL theo tập,
  route `GET /ops/status`, `POST /ops/check`, `GET|PUT /ops/settings`, vòng nền tick 60 s (`HUB_OPS_WATCH`).
- [x] Test: unit (luật thuần + contract), int quyền/idempotency/cấu hình/đồng thời/giữ 500 sự kiện.

## Không làm / Chạm
- Không làm 7 check còn lại (O2 thêm vào `adapters/checks/registry.ts`), trang `/system` (O3), `backup.sh`/cron/compose (O4).
- Chạm ngoài module: `app.ts` (mount + `/ops` trong PROTECTED_PREFIXES), `app.deps.ts`, `config/env.ts` + `env-deps.ts` (`HUB_OPS_WATCH`),
  `packages/db/src/migrate-hub.int.test.ts` (danh sách bảng hub). Không đổi grant/RLS bảng cũ.

## Test tối thiểu
- `apps/hub-api/src/modules/ops/domain/ops.rules.test.ts`, `packages/contracts/src/hub-admin/ops.test.ts` (unit).
- `apps/hub-api/src/modules/ops/ops.round.int.test.ts`, `apps/hub-api/src/modules/ops/ops.routes.int.test.ts` (int).

## Quyết định trong lúc làm
- Hạn lượt tính từ `ops_settings.last_round_at` (không từ `max(checked_at)`): mốc này đồng thời là khoá giành lượt — UPDATE có điều kiện
  `last_round_at IS NOT DISTINCT FROM <đã đọc>` ⇒ hai instance cùng lúc chỉ một lượt chạy, không giữ khoá/tx trong lúc check gọi mạng.
- Ghi kết quả dưới `pg_advisory_xact_lock` ⇒ "Kiểm tra ngay" chồng lượt nền vẫn chỉ sinh một sự kiện/chuông mỗi lần đổi. Mỗi lượt ≤ 7 câu
  SQL cố định (đọc, giành, scope, khoá, upsert+sự kiện, chuông, giữ 500).
- Chuông qua hàm DEFINER mới `notify.enqueue_ops` (người nhận = platform_admin `active` và không bị khoá, mỗi người theo tenant của họ;
  link `/system`): hub_rw không cần đọc `admin.users`, một câu cho mọi tenant. `notify.enqueue` gốc chỉ một tenant/tx nên không dùng.
- Lần đầu thấy check (chưa có hàng) ghi sự kiện `null → <trạng thái>`; chỉ báo chuông khi đổi sang warn/crit hoặc hồi phục warn/crit → ok;
  `unknown` (check lỗi/quá giờ) không báo.
- Lỗi cấu hình trả 422 `OPS_SETTINGS_INVALID` (kèm `details.issues`); "Kiểm tra ngay" lần 2 trong 60 s ⇒ 429 `OPS_CHECK_RATE_LIMITED` + `Retry-After: 60`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: phần lõi CR-104, yêu cầu ở docs/specs/ops-watch)

## Việc còn lại
- O2: thêm check vào registry theo `OpsCheck` (`apps/hub-api/src/modules/ops/application/ops.check.ts`), đọc ngưỡng từ `cfg.warn/crit`.
- Chưa có test đếm số câu SQL mỗi lượt (Luật 4c) — số câu cố định theo thiết kế, đếm ở review cuối đợt nếu cần.
