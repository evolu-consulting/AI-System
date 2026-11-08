---
id: cr120-invariants
lát: cr120-invariants
cr: CR-120 (phần F)
làn: nhanh
migration: không
phụ thuộc: CR-104 ops-watch (đã trên gd0); backfill process_tenant_defs là lát khác (đang chạy) — lát này KHÔNG viết backfill
---
## Plan (ngắn)
Sự cố: prod tenant Demo không thấy quy trình vì danh sách tenant thấy (`GET .../process-routing/:slot` → `processes`) đọc `hub.process_tenant_defs`
(hub 0087) còn việc gán của nó nằm ở `process_slot_assignments` (CR-105). Người dùng muốn dữ liệu lệch được hệ thống tự bắt, không phải người dùng.
1. Check ops-watch `flow_coverage` (cùng khuôn registry của `slo`/`stuck`): với MỖI (tenant bật gói của khe, khe quy trình đã đăng ký trong
   `slotRegistry`, trừ `dlc.*`) phải có ≥ 1 quy trình trong danh sách tenant thấy (hàng `process_tenant_defs` mà def chưa xoá mềm). "Hiệu lực" = luật
   ∨ quy trình đã gán ∨ mặc định khe ∨ gán cũ; ca đúng của sự cố = có đường chạy (mặc định/gán cũ) nhưng danh sách thấy được rỗng ⇒ vẫn crit.
   Một câu SQL tập hợp (khe qua một tham số JSON; `exists` theo PK/index), không ngưỡng (warn/crit = null).
2. e2e prod `e2e/deployed/20-flows-visible.ro.deployed.ts` (làn ro): demo-owner thấy ≥ 1 quy trình ở Cài đặt › Ứng dụng & quy trình và ở admin
   Quy trình nghiệp vụ (mục "Được platform gán"); NiTi `tien` chạy khi có NITI_TENANT/NITI_PW, ngược lại bỏ qua. Viết, KHÔNG chạy với prod.
3. Quy tắc review: bảng mới thay bảng khác ⇒ backfill + test backfill + quyết định writer cũ (`.claude/agents/reviewer.md` nhóm 4 + Blocker; `docs/CONVENTIONS.md` §8).

## Làm
- contracts: key `flow_coverage` (đơn vị `count`, không ngưỡng) + i18n vi/en.
- hub-api ops: `adapters/checks/flow-coverage.check.ts` (+ đăng ký `registry.ts`).
- Test: unit `flow-coverage.check.test.ts`; int `ops.flow-coverage.int.test.ts`; e2e deployed (không chạy).
- Docs: reviewer.md, CONVENTIONS.md §8.

## Không làm / Chạm
- Không migration, không backfill, không sửa writer cũ/đọc mới (lát khác). Không UI mới (thẻ /system tự hiện check mới theo `OPS_CHECK_KEYS`).
- Không đụng DLC (`dlc.*` bị loại khỏi kiểm), không module đóng băng.

## Test tối thiểu
- unit: `bun test apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts`
- int (evotest): `-Step int -Filter apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts`
- e2e prod: viết, không chạy (`bun run e2e:deployed` qua tunnel khi được phép).

## Quyết định trong lúc làm
- Tenant "bật gói" = entitlement `<gói>-read` chưa thu hồi ∧ feature không `off` ∧ tenant active (cùng nghĩa `packEnabled` + `affectedCte` của CR-105);
  gói của khe lấy từ `SlotSpec.packKey`. Khe cần kiểm lấy từ `slotRegistry` lúc chạy (gói chưa mount ⇒ không kiểm; chưa có khe nào ⇒ ok).
- Quy trình chỉ chưa xuất bản vẫn tính là "hiển thị" (đúng thứ `GET routing` trả, kèm `rel_version = null`); def đã xoá mềm không tính.
- Thông điệp nêu tối đa 5 tên tenant + "và N nữa"; `value.gaps` giữ tối đa 20 cặp cho gói chẩn đoán.
- e2e admin: mục "Được platform gán" chưa có trong admin-web hiện tại (lát backfill/UI) ⇒ bộ chọn mục là dự đoán (tiêu đề + dòng trong vùng chứa gần
  nhất); chốt lại khi mục xuất hiện.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-wave)

### ADDED admin/ops-watch-flow-coverage.md
#### Yêu cầu: Check quy trình hiển thị cho tenant
Mỗi lượt ops-watch kiểm: mọi tenant đang bật một gói có khe quy trình phải có ít nhất một quy trình (chưa xoá) trong danh sách tenant thấy của khe đó; thiếu thì check `flow_coverage` crit, nêu tên tenant và khe.
- Kịch bản: khi tenant bật gói mà việc gán chỉ nằm ở bảng gán cũ (danh sách tenant thấy rỗng) thì check crit nêu tên tenant và khe [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » tenant Demo thiếu quy trình hiển thị ⇒ crit, thông điệp có TÊN tenant + khe; apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts » tenant chỉ có gán cũ (Demo) và tenant có def đã xoá ⇒ crit nêu tên + khe, tenant tốt và tenant không bật gói không bị nêu]
- Kịch bản: khi mọi tenant bật gói đều có quy trình hiển thị (kể cả sau khi chép gán cũ sang bảng mới) thì check ok [test: apps/hub-api/src/modules/ops/ops.flow-coverage.int.test.ts]
- Kịch bản: khi nhiều tenant thiếu thì thông điệp chỉ nêu 5 tên đầu và số còn lại, số thật nằm ở value [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » nhiều tenant ⇒ chỉ nêu 5 tên đầu và 'và N nữa', số thật nằm ở value]
- Kịch bản: khi chưa tenant nào bật gói hoặc chưa khe nào đăng ký thì check ok, không truy vấn thừa [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » chưa có khe nào đăng ký ⇒ ok, không đụng DB]
- Kịch bản: khe dlc.* không bị kiểm [test: apps/hub-api/src/modules/ops/adapters/checks/flow-coverage.check.test.ts » bỏ khe dlc.*, feature = <gói>-read]
#### Yêu cầu: e2e prod kiểm quy trình hiển thị
Bộ e2e triển khai (làn chỉ đọc) kiểm người chủ công ty demo thấy ít nhất một quy trình ở Cài đặt › Ứng dụng & quy trình và ở admin Quy trình nghiệp vụ.
- Kịch bản: khi chạy với prod thì demo-owner thấy quy trình ở cả hai nơi; NiTi chỉ chạy khi có thông tin đăng nhập [test: thủ công — e2e/deployed/20-flows-visible.ro.deployed.ts chạy với prod qua tunnel, không chạy trong lát]

### ADDED engine/quy-tac-review-migration.md
#### Yêu cầu: Migration bảng thay thế phải backfill
Migration thêm bảng thay/chồng lên bảng khác phải kèm backfill, test backfill và quyết định rõ về code ghi bảng cũ; reviewer chặn nếu thiếu.
- Kịch bản: khi review gặp migration thêm bảng thay bảng khác mà không có backfill hoặc test backfill hoặc quyết định writer cũ thì đánh Blocker [test: thủ công — quy tắc review (.claude/agents/reviewer.md nhóm 4, docs/CONVENTIONS.md §8)]

## Việc còn lại
- Chạy `20-flows-visible.ro.deployed.ts` với prod khi backfill đã lên (cần xác nhận bộ chọn mục "Được platform gán").
- Lát backfill: sau khi chạy, `flow_coverage` phải xanh trên prod (lượt kiểm kế tiếp).
