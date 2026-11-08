---
id: cr125-m5-base
lát: cr125-m5-base
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-m2
---
## Plan (ngắn)
1. Bước cơ bản `core` vào sổ module qua `bindNode` (ghi nhận executor lõi, không đổi engine). Sự kiện contracts/community đã qua `bindEvent` từ m2.
2. Người dùng chốt: luật «hành động thật cần người duyệt ngay trước» (`process-real-rule.ts`) không còn cứng trong code mà là TIỀN ĐIỀU KIỆN node khai báo: `requires: { before: "approval" }` trên `AppNodeDecl`. Luật chung đọc từ `MODULES` theo `stage.node`.

## Làm
- `AppNodeDecl.requires?: NodeRequires` (`app-manifest/manifest.ts`); Ký số (`modules/contracts/esign/node.ts`) khai `requires: { before: "approval" }`.
- `process-real-rule.ts`: `requiresApprovalBefore(node)` đọc `MODULES`; `realActionAllowed`/`newRealViolation` nhận thêm `node?` trong stage (chữ ký tương thích: admin-web không phải sửa; stage draft mang `node` là tự dùng được).
- Lưu (`process-steps.ts` REAL_ACTION): truyền `node` vào shape ⇒ cùng một luật.
- `packs/core/nodes/core-nodes.binding.ts` (`bindCoreNodes`, đọc `CORE_MODULE`) gọi ở đầu `mountCoreTools`; `NodeBinding.executor?`.

## Không làm / Chạm
Không đụng admin-web (m6a), cấu hình/nhà cung cấp Ký số (m4), DLC, engine. Picker/kéo thả/nối lại đã dùng `realActionAllowed`/`newRealViolation` của contracts nên đọc cùng nguồn mà không sửa file FE.

## Test tối thiểu
- unit: `process-real-rule.test.ts` (đường picker/kéo thả = `newRealViolation`, công tắc = `realActionAllowed`, lưu = `processDefStagePaths`), `core-nodes.binding.test.ts`.
- int: `packs.module-registry.int.test.ts` (mount thật: bước core đã vào sổ, 0 lỗi).

## Quyết định trong lúc làm
- Stage KHÔNG mang node (tool gọi thẳng, bước Áp) hoặc node lạ giữ mặc định cũ = đòi người duyệt ngay trước (giữ hành vi, tránh lách luật bằng cách bỏ `node`). Node có khai báo mà không `requires` ⇒ không đòi gì (node đó tự chịu trách nhiệm khai nếu cần).
- Hạn chế đã biết: bước Áp / tool tự đứng vẫn dùng mặc định cứng đó cho tới khi chuyển thành node có khai báo (lát sau).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr124-cr125)

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Hành động thật cần người duyệt ngay trước do node khai báo
Điều kiện «bước hành động thật phải có bước duyệt ngay trước» không cố định trong code mà do node khai báo (`requires.before = approval` trong khai báo module); picker, kéo thả, nối lại và kiểm khi lưu cùng đọc khai báo đó. Ký số khai điều kiện này nên giữ nguyên hành vi; node không khai thì không bị đòi; stage không thuộc node nào giữ mặc định đòi người duyệt.
- Kịch bản: khi thêm hoặc kéo Ký số sau một bước tự động thì bị từ chối, sau bước duyệt thì được [test: packages/contracts/src/hub-admin/process-real-rule.test.ts » Ký số khai requires.before = approval, hành vi như cũ qua khoá node]
- Kịch bản: khi lưu quy trình có Ký số sau bước tự động thì báo REAL_ACTION, còn node không khai điều kiện thì không báo [test: packages/contracts/src/hub-admin/process-real-rule.test.ts » lưu (REAL_ACTION của Hub) đọc cùng khai báo: Ký số sau bước tự động ⇒ lỗi, node không đòi ⇒ không lỗi]
- Kịch bản: khi node có khai báo mà không có điều kiện thì được bật hành động thật ở mọi bước [test: packages/contracts/src/hub-admin/process-real-rule.test.ts » node có khai báo mà không có requires ⇒ không đòi gì (kể cả bước 0)]
- Kịch bản: khi stage không có node hoặc node lạ thì vẫn đòi người duyệt ngay trước [test: packages/contracts/src/hub-admin/process-real-rule.test.ts » stage không node / node lạ giữ mặc định cũ (đòi người duyệt)]
- Kịch bản: khi mount gói thì bước cơ bản của lõi vào sổ module và sổ không báo lỗi [test: apps/hub-api/src/modules/packs/core/nodes/core-nodes.binding.test.ts » module core: không lỗi sổ (không thiếu, không thừa binding)]

## Việc còn lại
- m4 đổi `esign/node.ts` (cấu hình/nhà cung cấp): giữ dòng `requires`.
- Chuyển bước Áp / tool tự đứng sang node có khai báo để bỏ mặc định cứng.
