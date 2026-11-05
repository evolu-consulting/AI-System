---
id: cr121-r2-run-log
lát: cr121-r2-run-log
cr: CR-121
làn: nhanh
migration: không
phụ thuộc: R-1 (dừng/chạy lại) sửa gates.routes.ts — lát này không đụng
---
## Plan (ngắn)
API dữ liệu cho trang chi tiết lượt chạy (mockup `Tpl-Run.dc.html`); CHƯA làm UI.
- `GET /process-runs/:id/detail` — header (tenant, người + nguồn kích hoạt, bước hiện tại, trạng thái + lý do dễ hiểu), danh
  sách bước (trạng thái nghiệp vụ, thời lượng, điều kiện rẽ nhánh + luật đã khớp) và dòng thời gian sự kiện. Đúng 3 câu SQL
  cố định (run · stage_runs · union sự kiện), không theo số bước.
- `GET /process-runs/:id/stages/:idx/log` — nhật ký MỘT bước; mức do SERVICE quyết theo vai (`logLevelOf`), không đọc tham số
  client: tenant admin ⇒ `basic`, platform_admin ⇒ `debug`. Basic = 1 câu SQL; debug = 3 (đọc + audit `view` + đọc scope system).
- Mã lỗi → câu tiếng Việt/Anh ở `domain/runs/run-log-text.rules.ts` (mặc định "Bước … chưa chạy được, hệ thống đang thử lại").
- Contract: `packages/contracts/src/chat/processes-run-log.ts` (file mới, export qua `@ai/contracts/chat`).

## Làm
- Domain thuần: `run-log-text.rules.ts` (ánh xạ lỗi, mức theo vai, trạng thái bước), `run-timeline.rules.ts` (dòng thời gian,
  điều kiện khớp).
- `runs/run-detail.repo.ts` (SQL), `runs/run-detail.map.ts` (DTO), `runs/run-detail.service.ts` (`RunDetailService`; `view.service.ts` đã chạm 400 dòng nên không thêm vào đó), 2 route trong `runs.routes.ts`.

## Không làm / Chạm
- Không UI, không dừng/chạy lại (R-1), không migration, không sửa `gates.routes.ts`.
- Debug đọc `hub.runs`/`hub.jobs` (RLS theo chủ run) bằng scope `system` SAU khi đã kiểm vai platform_admin + run thuộc tenant.
- Hạn chế: tên action audit cho dừng/chạy lại do R-1 đặt — hiện nhận `cancel`, `stop`, `resume`, `rerun`; đổi tên ⇒ cập nhật
  `readEvents` (1 chỗ).

## Test tối thiểu
- unit: `domain/runs/run-log-text.rules.test.ts`, `domain/runs/run-timeline.rules.test.ts`.
- int: `runs/run-detail.int.test.ts` (platform admin debug · tenant admin basic không lộ payload/error_message/mã lỗi · tenant
  khác 404 · member 403 · đếm câu SQL chi tiết ≤ 4, nhật ký ≤ 3).

## Quyết định trong lúc làm
- Endpoint mới thay vì mở rộng body `GET /process-runs/:id` (union `full|task` strict dùng cho chat) — không vỡ client cũ.
- Một endpoint nhật ký; "debug" không có route riêng nên tenant admin xin debug chỉ nhận basic (không 403).
- Trạng thái bước thêm `cancelled` ngoài 6 trạng thái của mockup (bước đã chạy rồi bị huỷ) — UI có thể gộp vào "lỗi".
- Không dùng `process_run_viewer`: trang chỉ cho admin (tenant_admin/platform_admin), RLS tenant + lọc `tenant_id` tường minh.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/run-log.md
#### Yêu cầu: Chi tiết lượt chạy cho admin (CR-121 R-2)
Admin xem header, danh sách bước (trạng thái, thời lượng, điều kiện rẽ nhánh khớp) và dòng thời gian sự kiện của một lượt chạy
bằng đúng 3 câu SQL cố định; tenant khác nhận 404, người không phải admin nhận 403.
- Kịch bản: khi tenant admin mở chi tiết lượt chạy của tenant mình thì thấy header, bước và dòng thời gian bằng câu dễ hiểu [test: apps/hub-api/src/modules/processes/runs/run-detail.int.test.ts » header + bước + dòng thời gian cho tenant admin và platform_admin]
- Kịch bản: khi admin tenant khác hoặc member mở chi tiết thì nhận 404 hoặc 403 [test: apps/hub-api/src/modules/processes/runs/run-detail.int.test.ts » chi tiết: tenant khác 404, member 403]
- Kịch bản: khi dựng dòng thời gian thì gom đủ bắt đầu, xong bước, rẽ nhánh, nhắc, chuyển cấp, lỗi, thử lại, quyết định, dừng/chạy lại [test: apps/hub-api/src/modules/processes/domain/runs/run-timeline.rules.test.ts » gom đủ loại sự kiện: nhắc, chuyển cấp, thử lại, quyết định, rẽ nhánh, quay lại, dừng/chạy lại]
- Kịch bản: khi mở chi tiết thì chỉ dùng tối đa 4 câu SQL không phụ thuộc số bước [test: apps/hub-api/src/modules/processes/runs/run-detail.int.test.ts » chi tiết ≤ 4 câu SQL cố định, không theo số bước]

#### Yêu cầu: Nhật ký một bước theo vai (CR-121 R-2)
Mức nhật ký do service quyết theo vai: platform_admin xem debug (mã lỗi, thông điệp gốc, các lần thử, payload job, đầu ra, số truy
vấn kh_stage_usage); tenant admin chỉ xem basic (ai xử lý, lúc nào, kết quả, lý do, bình luận, lỗi diễn đạt dễ hiểu) và không
bao giờ nhận payload/error_message/mã lỗi, kể cả khi gửi tham số mức debug.
- Kịch bản: khi platform_admin mở nhật ký bước thì thấy mã lỗi, thông điệp gốc, payload job và số truy vấn KH [test: apps/hub-api/src/modules/processes/runs/run-detail.int.test.ts » platform_admin ⇒ debug: mã lỗi, thông điệp gốc, các lần thử, payload job, số truy vấn KH]
- Kịch bản: khi tenant admin cùng tenant xin mức debug thì vẫn chỉ nhận basic không lộ payload/error_message [test: apps/hub-api/src/modules/processes/runs/run-detail.int.test.ts » tenant admin cùng tenant ⇒ basic: có người xử lý/kết quả/bình luận/lỗi dễ hiểu, KHÔNG payload/error_message/mã lỗi]
- Kịch bản: khi nhật ký được mở thì dùng tối đa 3 câu SQL (debug) và 2 (basic) [test: apps/hub-api/src/modules/processes/runs/run-detail.int.test.ts » nhật ký ≤ 3 câu SQL (debug) và ≤ 2 (basic)]
- Kịch bản: khi mã lỗi lạ hoặc vắng thì hiển thị "Bước … chưa chạy được, hệ thống đang thử lại" [test: apps/hub-api/src/modules/processes/domain/runs/run-log-text.rules.test.ts » mã lạ / vắng ⇒ câu mặc định 'chưa chạy được, hệ thống đang thử lại']
- Kịch bản: khi vai là tenant_admin hoặc member thì mức nhật ký là basic, chỉ platform_admin là debug [test: apps/hub-api/src/modules/processes/domain/runs/run-log-text.rules.test.ts » mức nhật ký theo vai: chỉ platform_admin là debug]

## Việc còn lại
- UI trang chi tiết lượt chạy (lát sau) dùng `RunDetailSchema` / `RunStageLogSchema`.
- Nếu R-1 đặt tên action audit khác `stop`/`resume`/`rerun`: sửa danh sách trong `readEvents` + `auditMade`.
