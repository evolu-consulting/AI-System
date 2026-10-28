# Ranh giới gói (pack boundary)

Mục tiêu: mỗi app pack (`apps/hub-api/src/modules/packs/<gói>` + schema Postgres cùng tên, vd `contracts`) tách được thành service riêng mà không viết lại. Luật được ép bằng `bun run depcruise` (`.dependency-cruiser.cjs`) và `bun run check:pack-sql`; cả hai nằm trong `bun run check`.

## Gói ĐƯỢC dùng (cổng công khai của nền tảng)
| Cổng | Nằm ở | Ghi chú |
|---|---|---|
| Ngữ cảnh auth, guard quyền gói | `lib/auth.middleware.ts`, `packs/kit/adapters/pack-guard.middleware` | `PackAccessView`, `PackGuardVars` |
| Transaction + biến phiên RLS | `packages/db` `pack-scope` (`withPackScope`, `withPackJobScope`), `packs/kit/adapters/pack-uow` (`PackUow`) | Gói chỉ chạm bảng của mình |
| AI client (usage + trần tenant) | `lib/ai-client/*` | Gói không gọi nhà cung cấp AI trực tiếp |
| Filebox | `packs/kit/adapters/pack-files.filebox` (`PackFileboxClient`), tiêm ở `packs.mount.ts` | |
| Đăng ký MCP tool | `packs/kit/application/pack-tools.ports` (`PackToolDef`) + `PackToolRegistry` | Tool của gói hiện ra cho agent qua registry |
| Tiện ích chung | `lib/errors`, `lib/http`, `lib/logger`, `lib/loop`, `lib/redis`, `@ai/contracts`, `@ai/db` (index) | |
| Khung `packs/kit/**` | cùng thư mục `packs/` | Phần nền tảng của cơ chế gói |

Mọi thứ khác gói cần (múi giờ tenant, config, egress HTTP như tra MST…) được **tiêm** ở `packs.mount.ts` (điểm nối duy nhất) qua port do gói tự khai báo trong `application/*.ports.ts`.

## Gói KHÔNG ĐƯỢC
- import gói khác (`packs/<B>/**`); chỉ chính nó và `kit/` (`pack-no-cross-pack`).
- import module khác của hub: `runs`, `agents`, `config`, `attachments`, `processes`… ở bất kỳ lớp nào, kể cả `*.mount.ts` (`pack-no-hub-modules`, `pack-no-hub-modules-any-layer`, `contracts-no-process-engine`).
- import `lib/*` ngoài danh sách cổng ở trên (`pack-ports-only-lib`; file test được miễn).
- đọc schema `admin`/`ops`/`permissions`/`totp`/`hub*` hoặc dùng `hub-scope` (`pack-no-hub-schema`, `pack-no-platform-db-internals`).
- migration SQL tham chiếu schema khác ngoài `contracts` (+ `packs.install`, `packs.secure_table`, `pg_catalog`): `check:pack-sql`.

## Nền tảng KHÔNG ĐƯỢC
- import `packs/<gói>/**` — chỉ `packs.mount.ts` và cổng `packs/kit/**` (ports, registry, guard, uow, converters) (`platform-no-pack-internals`).

## Cổng gói↔gói (ADR-0031, CR-102; chưa có code)
Gói cần dữ liệu/hành động của gói khác (vd `community` ghi giá vào `contracts`) **không import** gói kia. Gói cần khai một **port** trong `application/*.ports.ts` của mình (vd `SupplierQuoteWriter` do community khai, `HostBookReader` đọc SHT); `packs.mount.ts` — điểm nối duy nhất — dựng usecase của gói cung cấp (contracts) và tiêm vào gói cần. `pack-no-cross-pack` của depcruise giữ nguyên; thêm kiểm tra: chỉ `packs.mount.ts` được thấy cả hai gói. Port chỉ mang kiểu thuần (DTO tự khai), không kiểu của gói kia; usecase phía cung cấp tự kiểm quyền/RLS trong transaction của người gọi (cùng `PackUow`). Port chỉ có ở phía người dùng (kind=internal, vai chủ quản); user ngoài không bao giờ tới port.

## Nợ đã biết
Migration `contracts` 0009/0010/0015/0022 (đọc `admin.*`), 0011 (`hub.process_runs`), 0021 (`packs.pack_agents`) vi phạm; giữ baseline trong `KNOWN_DEBT` của `tools/scripts/src/check-pack-sql.ts` — xem `docs/TECH-DEBT.md` #255. Thêm vi phạm mới ⇒ check đỏ.