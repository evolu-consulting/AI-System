---
id: cr125-subprocess-ui
lát: cr125-subprocess-ui
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: cr125-subprocess-engine (contract `core.subprocess` + executor `subprocess` + runtime)
---
## Plan (ngắn)
Node "Quy trình con" (`core.subprocess`) ở trình sửa admin-web: một bước của quy trình cha chạy một quy trình khác rồi quay lại. Hình thống nhất với lát engine:
stage `{ key, name, node: "core.subprocess", executor: { kind: "subprocess", def_key, input_map? } }`, đầu ra `done` / `rejected` / `cancelled`, kết quả `sub.<field>`.

## Làm
- Menu "+ Thêm bước" (platform + công ty): mục "Quy trình con" kèm mô tả "Chạy một quy trình khác rồi quay lại" (`NodeMenuContent`; mục tự có khi bảng node `GET /process-palette` có `core.subprocess` với `menu.section = business`).
- Panel đăng ký ở `panelRegistry` (`modules/core/subprocess/Panel.tsx`, KHÔNG thêm đường sửa thứ hai): ô tìm chọn quy trình con (tên + trạng thái Đã xuất bản / Đang bật; nháp không chọn được), hiện CẦN gì (đầu vào của nó) / TRẢ gì (`sub.<ô>`), nối đầu vào từ các bước trước bằng `autoMapInputs` (tự nối khi chỉ một nguồn), liên kết mở quy trình con.
- Canvas: stage subprocess = một ô module (`collapseModules` coi stage đơn này là cụm 1): tên bước + huy hiệu "quy trình con" + tên quy trình con + số bước + ba cổng Xong / Từ chối / Huỷ + liên kết "Mở quy trình con" (`modules/core/subprocess/Body.tsx`).
- Đổi qua lại executor: `lib/subprocess-form.ts` + `FE_NODES.subprocess` (`nodes/registry.ts`) + `StageDraft.subprocess`.
- Lỗi: `process.admin.apiError.SUBPROCESS_NOT_FOUND|CYCLE|DEPTH` (vi + en) và vào `KNOWN` của `lib/errors.ts`. Khoá i18n nút/panel: `process.admin.subprocess.*`.

## Không làm / Chạm
- Không đụng `packages/contracts/src/modules/core/**`, runtime engine, DLC, lát khác. Không migration.
- Đích của cổng Từ chối / Huỷ: engine chưa quy định cách lưu (không có stage chờ ⇒ chưa có cạnh nhánh); hiện cổng chỉ để nhìn, kéo nối chưa có luật. Xong = đường đi tiếp thường.

## Test tối thiểu
- unit: `lib/subprocess-form.test.ts` (executor ⇄ nháp, chọn/đổi quy trình con, cần/trả, ô canvas 3 đầu ra, sổ panel, mã lỗi) — xanh.
- e2e (viết, CHƯA CHẠY): `e2e/journey-approval/cr125-subprocess-ui.spec.ts` — quản trị công ty thêm Quy trình con → chọn "Mua hàng · Phần 2" → Lưu → canvas hiện ô + liên kết; tự chụp `docs/specs/cr125-subprocess-ui/{panel,canvas-node}.png`.

## Quyết định trong lúc làm
- Contract chưa có trên gd0 ⇒ kiểu cục bộ `SubprocessExecutor` ở `lib/subprocess-form.ts`; `FE_NODES` = `{...BASE_NODES, subprocess}` ép kiểu.
- `input_map`: khoá = đầu vào của quy trình con, giá trị = `MapSource.id` của `autoMapInputs` (`<khoá đầu ra Bắt đầu khi>` hoặc `<node>:<khoá>`). Engine phải đọc đúng dạng này hoặc báo lại để đổi.
- "Trả về" = ô form + ô output của các bước của quy trình con, tên `sub.<ô>` (engine quy định thật).
- Quy trình chọn được = trong danh sách `GET /process-defs` của công ty (platform sửa Thư viện: cả bản Thư viện), đã xuất bản hoặc đang bật; không tự chọn chính nó (vòng gián tiếp: máy chủ trả `SUBPROCESS_CYCLE`).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/quy-trinh-con.md
#### Yêu cầu: Bước "Quy trình con"
Trình sửa quy trình có bước "Quy trình con": chạy một quy trình khác của công ty rồi quay lại; chọn quy trình đã xuất bản hoặc đang bật, thấy nó cần và trả gì, nối đầu vào từ các bước trước; trên sơ đồ hiện tên quy trình con, huy hiệu, ba cổng Xong / Từ chối / Huỷ và liên kết mở nó.
- Kịch bản: khi chọn quy trình con thì panel hiện nhãn trạng thái và đầu vào/kết quả của nó [test: apps/admin-web/src/features/processes/lib/subprocess-form.test.ts » cần gì / trả gì]
- Kịch bản: khi lưu stage subprocess thì executor mang def_key + input_map đi về nguyên vẹn [test: apps/admin-web/src/features/processes/lib/subprocess-form.test.ts » executor ⇄ bản nháp]
- Kịch bản: khi một bước là quy trình con thì ô canvas có ba đầu ra Xong / Từ chối / Huỷ [test: apps/admin-web/src/features/processes/lib/subprocess-form.test.ts » panel + canvas + lỗi]
- Kịch bản: quản trị công ty thêm Quy trình con, chọn "Mua hàng · Phần 2", lưu, canvas hiện ô và liên kết mở [test: thủ công — e2e `cr125-subprocess-ui.spec.ts` chờ lát engine gộp rồi chạy trên evotest]

## Việc còn lại
- Chạy e2e `cr125-subprocess-ui.spec.ts` trên evotest SAU KHI cr125-subprocess-engine gộp (điều phối báo); e2e tự chụp ảnh panel + ô canvas vào thư mục này.
- Sau khi gộp engine, đối chiếu: (1) thay kiểu cục bộ `SubprocessExecutor` bằng kiểu của contract và gỡ ép kiểu ở `FE_NODES` (`nodes/registry.ts`); (2) `core.subprocess` ở `CORE_MODULE` cần `menu: { section: "business" }`, `exits` done/rejected/cancelled (đã có dự phòng ở `use-module-canvas.ts`); (3) dạng `input_map` (xem Quyết định); (4) engine tự thêm khoá `apiError.SUBPROCESS_*` ⇒ trình gộp JSON xử lý; (5) cách lưu đích Từ chối / Huỷ để nối cổng.
- tsc cục bộ của admin-web đã đỏ sẵn ở worktree này (kiểu khoá i18n `process.admin.*` không có trong `resources`, cùng loại lỗi của `EsignPanel.tsx`); lát không thêm loại lỗi khác.
