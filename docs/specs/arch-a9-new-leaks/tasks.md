---
id: arch-a9-new-leaks
lát: arch-a9-new-leaks
cr:
làn: nhanh
migration: không
phụ thuộc: arch-a8-processes-packs
---
## Plan (ngắn)

Sửa thật (không baseline) các vi phạm lọt vào gd0 từ lát gần đây + vài mục tồn của `arch-a1-depcruise` § Kế hoạch dọn.

## Làm

- `pack-no-platform-db-internals` (partner-mailbox*): SQL đọc hub/admin của `receiveStateOf` chuyển sang kit `flowReceiveState` (`kit/adapters/flow-receive-state.ts`, xuất ở `kit/public.ts`); 2 int test dùng `kit/testing/system-scope.ts` (`withSystemScope`).
- `nodes/registry.test`: import tương đối được phân giải theo file — thư mục `nodes/` riêng của gói (`packs/<gói>/nodes/<kind>/binding`) là ruột gói, không còn bị tính là node lõi `processes/**/nodes/<kind>`.
- admin-web `StageForm`: hook `hooks/use-group-key-options.ts` (component không import `groups/api`).
- workspace-web `partner-inbox`: `hooks/use-partner-queries.ts` (vòng gửi, ghi nhận kết quả, cài đặt nhận) — 2 component chỉ trình bày.
- `packs.filebox` -> attachments qua `attachments/public.ts` (`FileboxClient`, `envFileboxToken`).
- `ca-domain-builtin-only`: cho `domain/` import `packages/contracts/src` (cùng điều kiện với `ca-application-inward-only`); `approval-flow-view.rules` bỏ `zod`; `price-tools.rules` lấy kiểu từ `domain/host-book.types.ts` (ports re-export); `images-pdf.rules.ts` (pdf-lib) chuyển sang `adapters/images-pdf.ts`.
- Baseline 47 -> 36 (sinh lại từ lần quét đầy đủ, không sửa tay).

## Không làm / Chạm

DLC (cross-module-deep 10, domain 2), canvas, mã audit/contract_events (cr125-audit-trail). Còn lại: pack-no-platform-db-internals 8, component-no-fetch 6 + legacy 3, ca-application 1, 2 vòng (dlc-workspace, P-d), pack-no-hub-modules 1, pack-ports-only-lib 1, no-routes-to-repo 1.

## Test tối thiểu

tsc hub-api/admin-web/workspace-web; `bun test apps/hub-api` + partner-inbox + admin processes (chỉ đỏ có sẵn K1 T5g); int evotest 7 file (partner-mailbox, partner-q4, partner-receive-arm, approval-flow-current, host-book, price.tools, upload-counter): 36 pass.

## Quyết định trong lúc làm

- Cho phép domain import contracts (cả runtime) như application: contracts chỉ có zod (kiểm bằng `contracts-only-zod`).
- Test ranh giới node phân giải đường dẫn thay vì khớp tên thư mục (tên `nodes/` trùng ở gói).

## Delta (so với docs/current)
Không thay đổi hành vi (lý do: refactor import/tách hook/tách file + luật dependency-cruiser; runtime không đổi).
Trạng thái gộp: chưa gộp

## Việc còn lại

Xem "Không làm / Chạm".