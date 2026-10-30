---
id: ops-ui
lát: ops-ui
cr: CR-104
làn: nhanh
migration: không
phụ thuộc: ops-core
---
## Plan (ngắn)
O3 của `docs/specs/ops-watch` (CR-104): trang `/system` "Tình trạng hệ thống" (platform_admin) trong admin-web, đọc/ghi Hub `/ops/*`.

## Làm
- [x] `apps/admin-web/src/features/system/`: `lib/ops.ts` (hàm thuần: trạng thái tổng, hạn kiểm kế, kiểm cấu hình khớp contract, lỗi 422, gói chẩn đoán),
  `api.ts` (status poll 60 s khi tab hiện, check ngay, lưu cấu hình), `components/{CheckCard,HistoryTable,ConfigPanel}`, `pages/SystemPage`.
- [x] Route `/system` (`PlatformOnly`), mục "Tình trạng hệ thống" đầu nhóm HỆ THỐNG (chỉ platform_admin), crumb, i18n vi/en, `routeTree.gen.ts`.
- [x] e2e `e2e/ops/system.ops.ts` + `e2e/ops/playwright.ops.config.ts` (dùng lại stack P-a, `HUB_OPS_WATCH=off`); đăng ký làn/Redis/META trong `tools/scripts`.

## Không làm / Chạm
- Không đụng hub-api (O1/O2), script host (O4). Chuông đã link `/system` từ O1.
- Chạm `tools/scripts` (e2e-lane.rules, test-e2e-par.rules, discover test) chỉ để nhận config e2e mới.

## Test tối thiểu
- unit: `apps/admin-web/src/features/system/lib/ops.test.ts`, `features/shell/lib/nav.test.ts`.
- e2e (chạy một lần): `bun run test:e2e:par --only=ops`.

## Quyết định trong lúc làm
- 429 "Kiểm tra ngay": đếm ngược cố định 60 s (CORS không lộ `Retry-After`; Hub dùng đúng 60 s).
- Tên người đổi cấu hình: Hub chỉ trả `actor_user_id` ⇒ hiện tên nếu là chính mình, ngược lại 8 ký tự đầu của id.
- Nút Lưu khoá khi có lỗi client (mirror contract); 422 từ Hub vẫn hiện theo ô nếu lọt.
- Lệnh chép được: đoạn trong dấu huyền (`…`) hoặc dòng `$ …` của gợi ý.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: giao diện CR-104, yêu cầu ở ops-watch)