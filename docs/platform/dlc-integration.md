# DLC (Rowan) — cách tích hợp với platform/gd0

DLC/AIDLC do Rowan sở hữu (nhánh `github/platform/gd0_dlc`, đã gộp vào `platform/gd0` ở merge 23a6e8ec). Prod chỉ deploy từ `platform/gd0`. Ta **không test code DLC**, nhưng giữ đường tích hợp dễ cho Rowan.

## 1. Ai sở hữu gì

| Đường dẫn | Chủ | Ghi chú |
|---|---|---|
| `apps/dlc-workspace/`, `tools/dlc-dify/` | Rowan | sửa tự do |
| `apps/hub-api/src/modules/packs/dlc/`, `modules/dlc-calls/`, `app.dlc.ts` | Rowan | |
| `packages/db/migrations-pack-dlc/` | Rowan | journal riêng, tự đánh số |
| `admin-web/.../processes/lib/dlc-slot*`, `components/library/DlcStageForm.tsx` | Rowan | |
| `packages/db/migrations-hub/` (dải DLC, mục 3) | chung | |
| `packages/db/src/migrate-packs.ts` (đăng ký pack DLC) | chung | |
| `admin-web/.../processes/components/canvas/*`, `lib/system-nodes.ts`, `fresh-stages.ts` | **ta**, Rowan có chạm | đổi nhỏ, báo trước |
| `packages/i18n/locales/process/admin.*.json` | chung | key DLC dưới prefix `dlc` |
| `hub-api/src/app*.ts`, `config/env*.ts`, `.env.example` | **ta**, Rowan có chạm | chỉ thêm dòng |

Mọi đường còn lại là của ta; muốn sửa thì mở PR và báo trước.

## 2. Luồng nhánh cho Rowan
1. Trước khi làm: `git fetch`, rồi tạo nhánh mới từ `platform/gd0`, hoặc `git merge github/platform/gd0` vào `gd0_dlc`.
2. Làm trong đường DLC-owned. Phải sửa chỗ chung thì giữ diff nhỏ, ghi rõ trong PR.
3. Trước khi bàn giao chạy: `bun run typecheck` (hoặc `bun run --filter <app> typecheck` cho app đã chạm: admin-web, hub-api, dlc-workspace), test riêng của DLC (`bun test apps/dlc-workspace apps/hub-api/src/modules/packs/dlc`) và `bun run dlc:check`.
4. Mở PR vào `platform/gd0` hoặc nhờ ta merge. Ta không rebase/sửa hộ nhánh của Rowan.

`bun run dlc:check [ref]` (mặc định `github/platform/gd0_dlc`; chỉ đọc, không fetch): liệt kê commit chưa vào HEAD, file đổi chia nhóm DLC / chỗ chung / khác, và migration hub có va số với ta không (thoát mã 1 nếu va).

## 3. Số dành riêng
- Hub migrations: dải **0070–0080** dành cho DLC (0070 đã dùng; max hiện tại của ta cũng là 0070). Phía ta **không dùng** dải này, đánh số từ 0081 trở lên. Cần quá 0080 thì báo ta cấp thêm.
- Pack-dlc: journal `migrations-pack-dlc` riêng, không liên quan số hub.
- Mỗi migration hub mới có đúng một entry `meta/_journal.json` (`when` tăng dần).
- **Luật `when` (CR-114, bắt buộc):** drizzle chỉ áp migration có `when` **lớn hơn** `created_at` của migration đã áp gần
  nhất trên DB — **không** theo số file. Migration DLC (vd 0071) mà `when` ≤ `when` lớn nhất đang có ở `platform/gd0` (vd
  0082 của ta, `when` 1802000000000) sẽ bị **bỏ qua âm thầm** trên prod/staging đã migrate. Vì vậy lúc merge, mỗi migration
  hub DLC phải có `when` **lớn hơn max `when` hiện có** trong journal của HEAD (sửa `when` khi rebase nếu cần; số file giữ
  trong dải). `bun run dlc:check` báo `WHEN CŨ` và thoát mã 1 khi vi phạm.

## 4. i18n
Key DLC đặt dưới một prefix `dlc` trong `packages/i18n/locales/process/admin.{vi,en}.json`. Merge driver JSON tự gộp file locale; chạy `bun install` một lần để cài (`postinstall` đăng ký driver).

## 5. Ta cam kết không đổi mà không báo Rowan
- Trường `StageView.dlc` và cách canvas hiển thị node DLC.
- Mặc định slot của thư viện quy trình (process library slot defaults).
- Chỗ đăng ký pack DLC trong `migrate-packs.ts` và điểm mount pack (`packs/core-tools.mount.ts`).
- Dải migration hub 0070–0080.

## 6. Cổng của ta bỏ qua DLC
Cổng/test của ta bỏ qua test thuộc DLC theo `tests/external-owned.json` (do lát khác thêm). Ta chỉ giữ typecheck + build xanh sau merge; test DLC đỏ là việc của Rowan.
