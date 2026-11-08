---
id: arch-a4-ops-adminapi
lát: arch-a4-ops-adminapi
cr:
làn: nhanh
migration: không
phụ thuộc: arch-a1-depcruise
---
## Plan (ngắn)

Lát 5 + 10 của `docs/specs/arch-a1-depcruise/tasks.md` § "Kế hoạch dọn": đưa ops (hub-api) và app-roles / internal-tokens / packs (admin-api) về đúng luật depcruise, không đổi hành vi.

## Làm

- hub-api `modules/ops`: application chỉ phụ thuộc cổng. `application/ops.ports.ts` (`OpsRepo`, `OpsState`), `application/overview.ports.ts` (kiểu dòng gom + `OverviewSource`), `OpsDbPort`/`OpsRedisPort` trong `ops.check.ts` (kiểu mờ; `check-kit.asDb/asRedis` ép về `Db`/`Redis`). Adapter mới `overview.source.ts` (6 câu SQL một tx + `host.json`, đúng thứ tự cũ) và `overview.wire.ts` (dựng service + lỗi 403); `ops.mount` tiêm repo/overview vào route, route không còn chạm repo.
- domain thuần: bỏ import contracts — `OpsStatus` khai báo trong `ops.rules`, nhãn check (`notificationsFor(ts, labelOf)`) và số ngày/giờ (`dailySeries(…, days)`, `hourlyColumns(…, hours)`) truyền qua tham số; application nối từ contracts.
- fixture int/perf của overview chuyển vào `ops/test/overview.fixture.ts` (không còn là mã production import test-kit).
- admin-api: `GrantChange` qua `grants.service`; `packs.service` gọi `insertDefaultRoles` qua `app-roles.service`; `internal-tokens.routes` gọi `internal-tokens.service` (dùng `auth.service.findUserById`) thay vì `auth.repo`; `roleError` chuyển sang `lib/errors.ts` (service không còn kiểu hono).
- Baseline `.dependency-cruiser-known-violations.json` 519 -> 502 (17 mục: ops 12, admin-api 5). Còn lại ở ops: 3 mục `platform-no-pack-internals` (lát 4).

## Không làm / Chạm

Không đụng module hub-api khác ops, `modules/packs/**`, admin-web. Không đổi SQL (số câu mỗi lượt ops-watch và 6 câu Tổng quan giữ nguyên).

## Test tối thiểu

Unit domain ops (đã sửa chữ ký), int ops (round/fix/checks/overview/routes/slo/…), int admin-api app-roles / packs / internal-tokens.

## Quyết định trong lúc làm

- `OpsDbPort`/`OpsRedisPort` = `object` (kiểu mờ) thay vì generic hoá `OpsCheck`: ít đổi 12 file check; một chỗ ép kiểu (`check-kit`).
- `roleError` đặt cạnh `extOrgError`/`tenantProfileError` trong `lib/errors.ts` (cùng mẫu khối lỗi riêng).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt CR-125 cuoi dot)

Không thay đổi hành vi (lý do: Clean Architecture ops/admin-api)

## Việc còn lại

- 3 mục `platform-no-pack-internals` của ops (flow-coverage.check + test) thuộc lát 4.
