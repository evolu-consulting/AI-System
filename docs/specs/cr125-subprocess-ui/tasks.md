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
stage `{ key, name, node: "core.subprocess", executor: { kind: "subprocess", def_key, input_map?, branches?: [{ on: "rejected"|"cancelled", goto_step }] } }`, đầu ra `done` (đi bước kế) / `rejected` / `cancelled` (rẽ theo `branches`), kết quả `outcome` + `sub_<field>`.

## Làm
- Menu "+ Thêm bước" (platform + công ty): mục "Quy trình con" kèm mô tả "Chạy một quy trình khác rồi quay lại" (`NodeMenuContent`; mục tự có khi bảng node `GET /process-palette` có `core.subprocess` với `menu.section = business`).
- Panel đăng ký ở `panelRegistry` (`modules/core/subprocess/Panel.tsx`, KHÔNG thêm đường sửa thứ hai): ô tìm chọn quy trình con (tên + trạng thái Đã xuất bản / Đang bật; nháp không chọn được), hiện CẦN gì (đầu vào của nó) / TRẢ gì (`sub_<ô>`), nối đầu vào từ các bước trước bằng `autoMapInputs` (tự nối khi chỉ một nguồn), liên kết mở quy trình con.
- Canvas: stage subprocess = một ô module (`collapseModules` coi stage đơn này là cụm 1): tên bước + huy hiệu "quy trình con" + tên quy trình con + số bước + ba cổng theo sổ module (Hoàn tất / Bị từ chối / Đã huỷ) — Từ chối / Huỷ vẽ cạnh thật tới bước đích của `branches`, kéo cổng tới bước sau để đặt đích + liên kết "Mở quy trình con" (`modules/core/subprocess/Body.tsx`).
- Đổi qua lại executor: `lib/subprocess-form.ts` + `FE_NODES.subprocess` (`nodes/registry.ts`, thay mục typecheck của engine) + `StageDraft.subprocess`; `branches` dùng chung khối `wait.branches` của nháp ⇒ `canvas-connect` (`waitIndexOf` coi stage subprocess là stage giữ nhánh) và `module-cluster.exitsOf` vẽ/kéo nối như Ký số.
- Lỗi: `process.admin.apiError.SUBPROCESS_NOT_FOUND|CYCLE|DEPTH` (vi + en) và vào `KNOWN` của `lib/errors.ts`. Khoá i18n nút/panel: `process.admin.subprocess.*`.

## Không làm / Chạm
- Không đụng `packages/contracts/src/modules/core/**`, runtime engine, DLC, lát khác. Không migration.

## Test tối thiểu
- unit: `lib/subprocess-form.test.ts` (executor ⇄ nháp, chọn/đổi quy trình con, cần/trả, ô canvas 3 đầu ra, sổ panel, mã lỗi) — xanh.
- e2e (viết, CHƯA CHẠY): `e2e/journey-approval/cr125-subprocess-ui.spec.ts` — quản trị công ty thêm Quy trình con → chọn "Mua hàng · Phần 2" → Lưu → canvas hiện ô + liên kết; tự chụp `docs/specs/cr125-subprocess-ui/{panel,canvas-node}.png`.

## Quyết định trong lúc làm
- Đã rebase lên gd0 (2c6e6138b): dùng kiểu `SubprocessExecutor` của contract; nhãn cổng lấy từ sổ module (Hoàn tất / Bị từ chối / Đã huỷ) — không nhân đôi nhãn ở web.
- `input_map`: khoá = đầu vào của quy trình con, giá trị = `MapSource.id` của `autoMapInputs` (`<khoá>` hoặc `<mã bước>:<trường>`) — đúng `SUBPROCESS_PATH_RE` của contract.
- "Trả về" = ô form + ô output của các bước của quy trình con, tên `sub_<ô>` (`SUBPROCESS_FIELD_PREFIX`).
- Quy trình chọn được = trong danh sách `GET /process-defs` của công ty (platform sửa Thư viện: cả bản Thư viện), đã xuất bản hoặc đang bật; không tự chọn chính nó (vòng gián tiếp: máy chủ trả `SUBPROCESS_CYCLE`).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

### ADDED sht/quy-trinh-con.md
#### Yêu cầu: Bước "Quy trình con"
Trình sửa quy trình có bước "Quy trình con": chạy một quy trình khác của công ty rồi quay lại; chọn quy trình đã xuất bản hoặc đang bật, thấy nó cần và trả gì, nối đầu vào từ các bước trước; trên sơ đồ hiện tên quy trình con, huy hiệu, ba cổng Xong / Từ chối / Huỷ và liên kết mở nó.
- Kịch bản: khi chọn quy trình con thì panel hiện nhãn trạng thái và đầu vào/kết quả của nó [test: apps/admin-web/src/features/processes/lib/subprocess-form.test.ts » cần gì / trả gì]
- Kịch bản: khi lưu stage subprocess thì executor mang def_key + input_map đi về nguyên vẹn [test: apps/admin-web/src/features/processes/lib/subprocess-form.test.ts » executor ⇄ bản nháp]
- Kịch bản: khi một bước là quy trình con thì ô canvas có ba đầu ra Xong / Từ chối / Huỷ [test: apps/admin-web/src/features/processes/lib/subprocess-form.test.ts » panel + canvas + lỗi]
- Kịch bản: quản trị công ty thêm Quy trình con, chọn "Mua hàng · Phần 2", lưu, canvas hiện ô và liên kết mở [test: thủ công — e2e `cr125-subprocess-ui.spec.ts` chờ lát engine gộp rồi chạy trên evotest]

## Việc còn lại
- e2e `cr125-subprocess-ui.spec.ts` chưa chạy lại sau khi đổi nguồn ô chọn sang `company-flows` (gồm flow Thư viện được gán; lần chạy trước đỏ vì nguồn cũ `process-defs` không thấy flow gán) — chạy ở đợt e2e cuối; spec tự chụp `panel.png` / `canvas-node.png`. Số bước của quy trình con không có trong danh sách flow công ty ⇒ chỉ hiện khi nguồn là `process-defs`.
- Cạnh Từ chối / Huỷ (branches) mới kiểm bằng unit (`subprocess-form.test.ts`: `connectPatch`, `collapseModules`), chưa qua e2e.
- Ảnh `panel.png` / `canvas-node.png` lấy từ outputPath của lượt e2e evotest (xem báo cáo lát).
- Nhãn cổng trên canvas là nhãn sổ module (Hoàn tất / Bị từ chối / Đã huỷ), không phải "Xong / Từ chối / Huỷ" như yêu cầu ban đầu — đổi ở `packages/contracts/src/modules/core/subprocess.ts` (lát engine sở hữu) nếu muốn.
- tsc admin-web: sau rebase, lỗi i18n-key của `EsignPanel.tsx` có sẵn ở baseline worktree; lát không thêm lỗi mới.