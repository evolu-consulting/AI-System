---
id: fnr-fix-unfreeze
lát: fnr-fix-unfreeze
cr: CR-103
làn: nhanh (không đổi quyền/route; chỉ header báo chế độ + cảnh báo UI + tài liệu)
migration: không
phụ thuộc: fnr-unfreeze
---
## Plan (ngắn)
Review fnr-unfreeze: ở `HUB_PROCESS_ROUTES=admin`, `/review-tasks/*` sau `requireAdminRole`, `/me/review-tasks` + asks không mount ⇒
Group duyệt toàn member thì không ai quyết được, câu hỏi AI không ai trả lời ⇒ lượt chạy treo `waiting_review`/`waiting_answer`.
Người dùng chốt: KHÔNG mở rộng route (editor/showcase chỉ admin, chat-web đóng băng). Lát này chỉ ghi ràng buộc + cảnh báo trong editor.

## Làm
- [x] Kiểm luật task bằng code + int: `gates.service.ts` `assertMayDecide` — không có ngoại lệ cho admin; người quyết phải là user
  assignee, thuộc Group duyệt / Group chuyển cấp / Group "cũng quyết", hoặc trưởng phòng (`group_head`); khác tenant (trừ
  platform_admin) ⇒ 404. Int `routes-mode.int.test.ts`: tenant_admin NGOÀI Group duyệt ⇒ 404; member trong Group ⇒ 403 (cổng route).
- [x] Hub báo chế độ qua chính lời dò: `GET /process-defs` ở `admin` trả header `X-Process-Routes: admin` (sau cổng role; CORS
  expose). Không route mới. Int: có ở `admin`, không có ở `all`.
- [x] admin-web: `probeEngineInfo` (`api.ts`) đọc header ⇒ `useProcessAdminOnly` (`engine.ts`, cùng cache dò); luật thuần
  `domain/admin-mode.rules.ts` + unit; `StageAdminModeNotice` trong `StageForm` (giai đoạn "Duyệt bởi Group" và giai đoạn có
  "Người trả lời"); i18n vi/en `process.admin.editor.stage.adminMode{Review,Ask}`.
- [x] `docs/platform/modules.md` ghi ràng buộc.

## Không làm / Chạm
- Không nới luật task, không mount thêm route (asks, `/me/*`), không đổi RLS.

## Test tối thiểu
- unit: `admin-web/src/features/processes/domain/admin-mode.rules.test.ts`.
- int: `bun run test:int:par apps/hub-api/src/modules/processes/routes-mode.int.test.ts` (7 pass).

## Quyết định trong lúc làm
- Báo chế độ bằng header trên `/process-defs` (lời dò sẵn có) thay vì đổi body/contract hay thêm route; chỉ admin nhận (sau cổng).
- Cảnh báo "trả lời" hiện cho mọi giai đoạn có "Người trả lời" (không riêng Group): ở `admin` route trả lời không mount nên ai cũng
  không trả lời được — đúng hơn "phải là admin trong Group".
- `beforeAll` của int test nâng 60 s → 120 s: dựng DB chậm khi `test:all` chạy song song trên máy (lưới an toàn, không phải chờ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/flow-engine.md
#### Yêu cầu: Cảnh báo người duyệt ở chế độ chỉ quản trị
Khi Hub chạy `HUB_PROCESS_ROUTES=admin`, `GET /process-defs` trả header `X-Process-Routes: admin`; editor quy trình của admin-web
hiện cảnh báo trên giai đoạn "Duyệt bởi Group" (chỉ admin thuộc Group duyệt mới duyệt được) và giai đoạn có "Người trả lời"
(câu hỏi AI không trả lời được, lượt chạy sẽ chờ). Luật quyền quyết task không đổi.
- Kịch bản: khi Hub ở chế độ `admin` và admin mở giai đoạn "Duyệt bởi Group" trong editor thì thấy cảnh báo chỉ admin thuộc Nhóm kiểm mới duyệt được.
- Kịch bản: khi Hub ở chế độ `admin` và tenant_admin không thuộc Group duyệt gọi `POST /review-tasks/:id/decision` thì Hub trả 404.

## Việc còn lại
- Nếu cần member duyệt / trả lời trên prod: phải mở hộp việc chat-web (`HUB_PROCESS_ROUTES=all` + build chat-web cờ on) — quyết của
  người dùng, ngoài lát.
