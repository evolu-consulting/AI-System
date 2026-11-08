---
id: cr120-spec
lát: cr120-spec
cr: CR-120
làn: nhanh
migration: không
phụ thuộc: hub-routing-backfill (đang mở, chỉ tham chiếu)
---
## Plan (ngắn)
Viết spec CR-120 (`docs/specs/CR-120/spec.md`), ADR-0036, hàng CR-120 ở `docs/CHANGE-REQUESTS.md`. Chỉ tài liệu.

## Làm
- [x] spec CR-120 (A–G: hợp đồng khe, một nguồn gán, runtime bật, loại bước, def mặc định, bất biến, lát + số migration)
- [x] §8b UI nhất quán + một khung (điều phối gửi thêm 2026-11-05; lát cr120-one-shell đang chạy)
- [x] ADR-0036 + mục lục ADR
- [x] CHANGE-REQUESTS CR-120

## Không làm / Chạm
Không code, không migration.

## Test tối thiểu
`bun run openspec:check`.

## Quyết định trong lúc làm
- Đợt 1 = 5 lát song song (slot-contract, single-source, runtime-on, community-flows, invariants); khoảng trống loại bước G2–G6 +
  def `contracts.intake` dồn sang đợt 2 (`cr120-contracts-flow`) vì cần node engine mới (Opus).
- Khe community khai báo trong manifest ở lát slot-contract (dữ liệu) để `check:app-slots` xanh ngay khi gộp; adapter ở community-flows.
- Cấp phát cho tenant bật app làm bằng `ensureSlotDefaults` lúc boot/`config_changed` (không trong migration, vì trạng thái bật app ở
  DB admin); migration 0090 chỉ chuyển gán cũ thành luật mặc định.
- `contracts.approval` giữ cổng add-on `contracts-approval-engine` (tenant thiếu add-on vẫn máy trạng thái, hiện qua LegacyMachineRenderer).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

Không thay đổi hành vi (lý do: lát chỉ viết spec/ADR/CR; hành vi đổi ở các lát cr120-* theo Delta riêng).

## Việc còn lại
- Điều phối giao 5 lát đợt 1 theo spec §8; đợt 2 sau khi gộp.
