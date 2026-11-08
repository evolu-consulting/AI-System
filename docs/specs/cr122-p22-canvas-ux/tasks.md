---
id: cr122-p22-canvas-ux
lát: cr122-p22-canvas-ux
cr: CR-122
làn: nhanh
migration: hub 0115 (hub.platform_settings + nới CHECK stage 22 → 50)
phụ thuộc:
---
## Plan (ngắn)
Ba yêu cầu của người dùng (2026-11-07) cho canvas quy trình:
1. Kéo cổng ra của node sang node khác để đặt đích: bước thường → "Sau đó đi tiếp" (`nextStep`), node Nếu → cổng Đúng / Sai (`ifx.yes/no`). Luật thuần ở `lib/canvas-connect.ts`.
2. Mọi ô "tới bước" hiện "Bước N · tên bước" (`lib/step-options.ts`, hook `useStepOptionLabel`).
3. Số bước tối đa là cài đặt nền tảng (`hub.platform_settings`, khoá `process.stages_max`), mặc định 22, trần cứng 50.

## Làm
- contracts: `PROCESS_STAGES_DEFAULT` (=22, giữ `PROCESS_STAGES_MAX` cho tương thích), `PROCESS_STAGES_CEILING` = 50 dùng cho mọi schema `.max(...)`, `resolveStagesMax`, `process-limits.ts` (GET/PUT body).
- hub-api: `GET /process-editor/limits` (admin) · `PUT` (platform_admin); `create/update` def kiểm số stage ≤ cài đặt ⇒ 422 `PROCESS_DEF_INVALID` + `details.stages_max`.
- db: migration hub 0115.
- admin-web: cổng ra hiện (`OutPort`), `ops.connect`, nhãn bước, `useStagesMax` (canvas `room`, "Thêm bước" tắt + tooltip, `step-ops`, `validateDraft`), panel "Giới hạn quy trình" ở `/system`.

## Không làm / Chạm
- Không đổi `pack-scope.ts`, contracts esign/visibility, DLC. Canvas thư viện (khe) giữ nguyên: chỉ cổng "Từ chối" của bước DLC.
- Ô "Nếu bị trượt, quay lại" là hộp chọn nhiều bước (đã có tên bước ở dòng mô tả) — giữ.
- `library.service` (lưu def thư viện) chưa kiểm cài đặt nền tảng (chỉ trần cứng 50 của schema/DB).

## Test tối thiểu
- unit: `canvas-connect.test.ts`, `step-options.test.ts`, `process-limits.test.ts` (contracts).
- int: `defs-limits.int.test.ts` (endpoint + kiểm khi lưu), `migrate-hub.int.test.ts` (bảng mới).
- e2e (viết, chạy ở đợt cuối): `e2e/fnr-showcase/canvas-ux.fnr.ts` (3 ca).

## Quyết định trong lúc làm
- Lưu cài đặt ở bảng khoá/giá trị mới `hub.platform_settings` (chưa có bảng cài đặt nền tảng chung; `ops_settings` là cấu hình ops-watch có schema chặt).
- Trần cứng 50 kéo theo nới CHECK DB chỉ số stage/bước 0..21 → 0..49 (chỉ nới, như 0097).
- Biến module `lib/stages-limit.ts` nạp từ hook cho các phép thuần (`step-ops`, `validateDraft`); Hub là nơi chặn thật.
- Bước đi tiếp = bước ngay sau ⇒ xoá `nextStep` (mặc định tuần tự).

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Kéo mũi tên trên canvas để đặt đích của bước
Trên canvas sửa được, node có cổng ra hiện ở mép phải: kéo sang node ở bước SAU thì đặt "Sau đó đi tiếp" của bước thường, hoặc "Đúng thì tới bước" / "Sai thì tới bước" của node Nếu (hai cổng có nhãn Đúng / Sai); ngăn chi tiết đổi ngay. Đích không ở bước sau, hoặc nhánh Nếu trỏ tới bước có hành động thật, thì không đổi gì và báo lý do bằng một câu tiếng Việt.
- Kịch bản: khi kéo cổng Sai của node Nếu sang một node ở bước sau thì trường Sai đổi sang bước đó và giữ nguyên Đúng [test: apps/admin-web/src/features/processes/lib/canvas-connect.test.ts » Sai của Nếu ⇒ ifx.no (đếm từ 1), giữ nguyên Đúng]
- Kịch bản: khi kéo về bước đứng trước hoặc nhánh Nếu tới bước có hành động thật thì bị từ chối kèm mã lỗi [test: apps/admin-web/src/features/processes/lib/canvas-connect.test.ts » đích không ở bước sau ⇒ lỗi, không đổi gì]
- Kịch bản: khi kéo cổng Sai trên canvas thật thì ô "Sai thì tới bước" hiện bước vừa nối [test: e2e/fnr-showcase/canvas-ux.fnr.ts » CR-122 · p22 · kéo cổng Sai của node Nếu sang bước sau ⇒ ô 'Sai thì tới bước' đổi ngay, các ô chọn hiện 'Bước N · tên']

#### Yêu cầu: Ô chọn bước hiện tên bước
Mọi ô chọn "tới bước" (Đúng/Sai, "Thì tới bước" của rẽ nhánh, "Sau đó đi tiếp", kết quả chờ) hiện "Bước N · <tên các giai đoạn trong bước>", nhiều giai đoạn nối bằng " / "; bước chưa đặt tên chỉ hiện "Bước N".
- Kịch bản: khi một bước có hai giai đoạn thì nhãn nối tên bằng " / " [test: apps/admin-web/src/features/processes/lib/step-options.test.ts » nhiều giai đoạn ⇒ nối bằng ' / ']

#### Yêu cầu: Số bước tối đa của quy trình là cài đặt nền tảng
Quản trị nền tảng đặt số bước tối đa của một quy trình ở trang Hệ thống (mặc định 22, trần 50). Trình sửa dùng giá trị này cho nút "Thêm bước" (tắt + chú thích) và canvas; Hub từ chối lưu quy trình dài hơn bằng lỗi nêu trần hiện hành; quản trị công ty chỉ đọc.
- Kịch bản: khi trần là 3 thì lưu quy trình 4 bước bị 422 kèm trần, nâng lên 30 thì lưu được 25 bước [test: apps/hub-api/src/modules/processes/defs/defs-limits.int.test.ts » lưu quy trình vượt cài đặt ⇒ 422 kèm trần, nâng lên 30 thì lưu được 25 bước (DB nới CHECK)]
- Kịch bản: khi giá trị thiếu hoặc sai thì dùng mặc định 22 và luôn kẹp ≤ 50 [test: packages/contracts/src/hub-admin/process-limits.test.ts » thiếu/sai ⇒ mặc định 22]

## Việc còn lại
- Chạy e2e `canvas-ux.fnr.ts` (xem `playwright.fnr.config.ts`).
- Ghi audit khi platform_admin đổi giới hạn (hiện chỉ lưu `updated_by/updated_at`).
- Kiểm cài đặt ở `library.service` (lưu def thư viện) nếu muốn áp cho cả mẫu.
