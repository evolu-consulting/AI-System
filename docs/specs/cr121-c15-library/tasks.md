---
id: cr121-c15-library
lát: cr121-c15-library
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: cr121-c, c11, c13
---
## Plan (ngắn)
Bảng Thư viện quy trình (`/processes`, platform_admin) đối chiếu artboard `Library` (`scratchpad\cr121-design\project\Library.dc.html`), spec R5 + Q11.
Cột: Quy trình (tên + vN + nhãn việc) · Các bước (chip TÊN bước ≤ 4 + "+N", nhãn điều kiện) · Dùng bởi (số công ty) · Trạng thái · Cập nhật (+ cột thao tác Nhân bản/Xoá không tiêu đề). Ô tìm, bộ lọc. Bấm dòng ⇒ trình sửa (mặc định canvas).

## Làm
- Hub: `GET /process-defs` mục thư viện trả thêm `steps: [{name, when?}]` rút từ `slot_body` TRONG CÙNG câu SQL (subquery cùng hàng, không truy vấn theo hàng) — vì danh sách chỉ có `stage_count`, không đủ để vẽ chip tên bước. Contract `LIBRARY_LIST_ITEM_FIELDS.steps` (optional, ≤ 22).
- Chip dùng chung: `features/processes/components/StepChips.tsx` + `lib/step-chips.ts` (một component cho Thư viện và Công ty › Quy trình; `tenants/flows/components/StepChips.tsx` xoá, JobRow đổi import).
- Bảng: `ProcessesTable.libraryColumns`; `LibraryListCells`: `StepsCell`, `UsedByCell` (đếm sẵn — bỏ `TenantsCell` gọi `useAssignments` theo từng hàng = N+1), `StatusCell` thêm "Đã tắt" + lý do. Gỡ `tenantsSummary`/`assignedNames` (hết chỗ dùng, D6). Bấm cả hàng dùng `onRowClick` của DataTable.
- Tìm: `?q=` (khớp tên quy trình, TÊN bước, tên việc; bỏ dấu), `searchLibrary`/`parseSearchQ` trong `lib/library-filter.ts`, ô trong `LibraryFilter`.
- Lọc "Dùng bởi" đổi tham số `?tenant=` ⇒ `?usedBy=` (trùng URL chuyển hướng cũ của c13). `?tenant=<id>` giờ chuyển tới Công ty › Quy trình kể cả khi kèm bộ lọc (`processesRedirectTenant`); route `validateSearch` giữ `tenant` chỉ để chuyển hướng.
- Tiêu đề trang "Thư viện quy trình", phụ đề "Mẫu dùng chung cho mọi công ty.", nút "Tạo quy trình"; nhãn "tenant" ⇒ "công ty" ở bảng/lọc (i18n vi+en).
- Chế độ xem canvas/danh sách (`lib/view-mode.ts`, Q11): trình sửa thư viện đã mở ở canvas (`LibraryEditorBody` mode "canvas"); công tắc canvas/danh sách trong trình sửa là phần c17 — c15 không tạo thêm công tắc.
- e2e viết, KHÔNG chạy: `admin-processes.pa.ts` (E-P15a: xoá ca "Chép mẫu sdlc ⇒ bật báo lỗi Group kiểm" — không còn chỗ tạo quy trình theo công ty ở /processes; thay bằng nav Adm ⇒ Công ty › Quy trình + hành trình Thư viện 5 cột/tìm/bấm dòng ⇒ canvas), `admin-editor.pa.ts` (E-P15b: mở `hoa-don-t`/mẫu `sdlc` thẳng theo id từ Hub), `canvas.pb2.ts` (E-PB2-12: mở mẫu `sdlc` thẳng theo id), `_pb2-support.ts` (`openDef` mở theo id vì danh sách theo công ty đã gỡ; thêm `openTemplate`), `process-library.pa.ts` (cột "Dùng bởi", "1 công ty").

## Không làm / Chạm
Không: trình sửa/công tắc view (c17), tab Mẫu · chạy thử (giữ nguyên, ngoài artboard — xem khác biệt), DLC.
Perf: không chạm đường nóng; danh sách vẫn `limit` 50 + cursor; thêm một subquery trên chính hàng đang đọc; bỏ N+1 `useAssignments` theo hàng.

## Test tối thiểu
- unit: `lib/step-chips.test.ts` (chip, +N, nhãn điều kiện), `lib/library-filter.test.ts` (`usedBy`, tìm), `tenants/lib/legacy-redirect.test.ts`, hub `defs.map.test.ts » listSteps`.
- int (1 lượt evotest, xanh 15/15): `library.routes.int.test.ts` (danh sách trả tên bước đúng thứ tự).
- e2e viết, không chạy (xem trên).

## Đối chiếu artboard Library (bằng code; ảnh chụp do điều phối ở UAT)
Khớp: tiêu đề/phụ đề, nút "Tạo quy trình", ô tìm + nút Lọc, cột Quy trình/Các bước/Dùng bởi/Trạng thái/Cập nhật, nhóm theo app có tên app, chip tên bước, "Chưa công ty nào dùng", bấm hàng mở trình sửa.
Khác biệt còn lại (chờ điều phối duyệt):
1. Hai tab "Thư viện" / "Mẫu · chạy thử" còn trên trang (artboard không có tab) — tab Mẫu chạy thử ngoài phạm vi lát.
2. Thêm cột thao tác (Nhân bản, Xoá) không có trong artboard — Xoá/Nhân bản của thư viện không có chỗ khác.
3. Lọc: popover có Ứng dụng/Việc/Trạng thái/Dùng bởi (artboard chỉ Ứng dụng) + chip lọc; không có bộ đếm "N quy trình" và dấu chấm trạng thái xanh "Đang bật" (dùng huy hiệu Nháp/Đã xuất bản vN).
4. Chip dạng viên có tên bước (artboard dùng vòng tròn số/biểu tượng + dấu nối); nhãn điều kiện hiện dòng chữ dưới chip thay vì huy hiệu "≥ 500 triệu" rút gọn.
5. Số bước = tên bước từ `slot_body`; khe DLC (không có `slot_body` dạng bước tuần tự) hiện số bước.

## Quyết định trong lúc làm
- Thêm `steps` vào danh sách Hub thay vì gọi chi tiết từng quy trình (N+1 HTTP).
- Giữ `?tenant=` là URL cũ duy nhất; bộ lọc mới `usedBy`.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/thu-vien-quy-trinh-bang.md
#### Yêu cầu: Bảng Thư viện quy trình theo artboard Library (CR-121 R5)
`/processes` (platform_admin) là Thư viện quy trình, bảng có 5 cột Quy trình · Các bước · Dùng bởi · Trạng thái · Cập nhật; "Các bước" là chip TÊN bước (tối đa 4 rồi "+N"), "Dùng bởi" là số công ty ("Chưa công ty nào dùng" khi 0); ô tìm khớp tên quy trình, tên bước và tên việc; bấm một dòng mở trình sửa ở chế độ canvas mặc định. Bộ lọc "Dùng bởi" dùng tham số `?usedBy=`; `?tenant=<id>` chỉ là URL cũ chuyển tới Công ty › Quy trình.
- Kịch bản: chip chỉ hiện tối đa 4 tên bước, phần còn lại là "+N" [test: apps/admin-web/src/features/processes/lib/step-chips.test.ts » splitChips]
- Kịch bản: tìm khớp tên bước, bỏ dấu, không phân biệt hoa thường [test: apps/admin-web/src/features/processes/lib/library-filter.test.ts » CR-121 c15 · ô tìm]
- Kịch bản: `?tenant=` không còn là bộ lọc, `?usedBy=` là bộ lọc [test: apps/admin-web/src/features/processes/lib/library-filter.test.ts » CR-121 c15 · ?tenant= không còn là bộ lọc (đã đổi thành usedBy)]
- Kịch bản: `/processes?tenant=<id>` kể cả kèm bộ lọc chuyển tới Công ty › Quy trình [test: apps/admin-web/src/features/tenants/lib/legacy-redirect.test.ts » CR-121 c13 · /processes?tenant= chuyển tới Công ty › Quy trình]
- Kịch bản: danh sách thư viện của Hub trả tên bước theo thứ tự [test: apps/hub-api/src/modules/processes/library/library.routes.int.test.ts » cờ has_unpublished_changes: xuất bản ⇒ false, sửa nháp ⇒ true, xuất bản lại ⇒ false]
- Kịch bản: bảng có đủ 5 cột và bấm dòng vào trình sửa canvas [test: thủ công — e2e/P-a/pf4/admin-processes.pa.ts viết, chạy một lần cuối đợt]

## Việc còn lại
- Điều phối: chụp ảnh UAT đối chiếu artboard, duyệt 5 khác biệt trên; chạy e2e 4 file đã sửa.
- c17: công tắc canvas/danh sách (`view-mode.ts`) trong trình sửa thư viện.
- Thư mục `docs/current` gộp sau.