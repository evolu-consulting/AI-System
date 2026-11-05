---
id: cr121-p1-prod-preflight
lát: cr121-p1-prod-preflight
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Script vận hành chỉ đọc kiểm prod trước deploy CR-120 + CR-121: `deploy/prod-sohoptac2/preflight-cr121.{sh,sql,ps1}`. SQL trong `BEGIN READ ONLY … ROLLBACK`, chạy qua `docker compose exec -T pg psql` như `backup.sh`; mỗi mục in OK / CẢNH BÁO / CHẶN + cách sửa tiếng Việt.

## Làm
- [x] 1 Postgres ≥ 15 · 2 phụ thuộc view `hub.process_slot_assignments` (pg_depend) · 3 migration prod vs journal repo (hub, pack-contracts, admin)
- [x] 4 số hàng `process_runs`/`dify_runs` (> 1 triệu ⇒ cảnh báo) · 5 khe `contracts.approval` chạy được theo công ty · 6 nhóm quy trình + `contracts-editor` theo công ty
- [x] 7 lượt duyệt máy cũ còn dở (chỉ in số) · 8 `HUB_FLOW_RUNTIME` (chỉ on/off)
- [x] README mục "Kiểm trước deploy CR-120 + CR-121"; `preflight-cr121.ps1` (ssh, đọc journal của `-Ref`, `-DryRun` không kết nối)

## Không làm / Chạm
Không kết nối prod trong lát; không đổi `deploy.ps1`, không migration, không đổi hành vi app. Điều phối chạy script sau khi người dùng đồng ý.

## Test tối thiểu
`packages/db/src/preflight-cr121.int.test.ts`: chạy file SQL trong giao dịch READ ONLY trên DB đủ migration; công ty có `contracts-read` thiếu `contracts-editor` ⇒ CHẶN.

## Quyết định trong lúc làm
- Công ty "đọc được gói contracts" = active + `feature_entitlements` chưa thu hồi của feature `contracts-read` (feature chưa `off`).
- Quy trình hiệu lực mirror `RESOLVE_SLOT_SQL`: luật `is_default` của công ty ⇒ `process_slots.default_def_id`; kiểm nhóm gồm mọi luật của công ty × khe.
- `HUB_FLOW_RUNTIME=off` ⇒ CHẶN (CR-121 gỡ legacy-act của web).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: script vận hành)

## Việc còn lại
Điều phối chạy `preflight-cr121.ps1` trên prod sau khi người dùng đồng ý.