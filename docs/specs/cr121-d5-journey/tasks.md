---
id: cr121-d5-journey
lát: cr121-d5-journey
cr: CR-121 (phần D-5)
làn: nhanh
migration: không
phụ thuộc: D-0..D-4 đã gộp
---
## Plan (ngắn)
Một e2e HÀNH TRÌNH THẬT hai công ty (R8) trên stack `journey-approval`: stack dựng thêm 2 công ty MỚI (hậu tố duy nhất, không quy trình/luật/gán);
spec làm như platform admin: nhân bản quy trình thư viện → sửa điều kiện → xuất bản → gán ở Công ty › Ứng dụng & Gói → đặt mặc định; người dùng
mỗi công ty gửi duyệt HĐ 600 tr / 100 tr; sửa giá trị HĐ đang chờ; trang Chi tiết lượt chạy; kiểm cách ly.

## Làm
- `e2e/journey-approval/cr121-d-journey.spec.ts` (8 ca) + `_ja-stack.ts` dựng 2 công ty qua `provisionExtraJourneyTenant` + CLI AI giả đọc giá trị HĐ từ văn bản.
- `e2e/_kit/api.ts`: `tenantIdByKey`, `cloneAndPublishFlow` (nhân bản + sửa bước + xuất bản).
- Sửa e2e cũ vỡ vì D-4 (không còn công tắc `tenant-engine-switch`/`tenant-engine-off-note`): `_journey.ts` (bỏ `adminSetEngine`),
  `approval.ja.ts`, `deployed/21-*`.

## Không làm / Chạm
Không đổi code sản phẩm. Chạm `tools/scripts/src/seed-e2e-journey.ts` (thêm `provisionExtraJourneyTenant`, tái dùng cùng luật guard `e2e-`).

## Test tối thiểu
`run-tests.ps1 -Step e2e -Filter journey-approval -Dirty` (job journey-approval-journey).

## Quyết định trong lúc làm
- Giá trị HĐ chỉ sửa được khi bước đầu của luồng đang mở (luật cũ HD3 S1) ⇒ ca "sửa 600 → 100" sửa lúc Kế toán đang mở, không cần Trả lại.
- Hành trình chỉ gán qua UI (không workaround luật); chờ lát F-1 (gán ⇒ luật mặc định = quy trình đã gán) rồi mới chạy lại.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Hai công ty gán hai quy trình khác nhau chạy đúng bước theo giá trị và loại HĐ
Platform admin nhân bản quy trình duyệt từ thư viện, đặt điều kiện cho bước (vd Giám đốc chỉ khi Giá trị ≥ 500 tr và Loại = Mua), xuất bản và gán cho
từng công ty; mỗi công ty chạy đúng quy trình của mình, bước không thỏa điều kiện bị bỏ qua, sửa giá trị HĐ đang chờ đổi bước theo giá trị mới,
công ty này không thấy dữ liệu công ty kia.
- Kịch bản: khi công ty 1 (Kế toán → Giám đốc khi ≥ 500 tr và Mua) gửi HĐ 600 tr thì qua cả Kế toán lẫn Giám đốc [test: e2e/journey-approval/cr121-d-journey.spec.ts » 3 · công ty 1: HĐ 600 tr Mua đi qua Kế toán rồi Giám đốc, duyệt xong là khoá]
- Kịch bản: khi công ty 1 gửi HĐ 100 tr thì bước Giám đốc bị bỏ qua và HĐ khoá sau Kế toán [test: e2e/journey-approval/cr121-d-journey.spec.ts » 4 · công ty 1: HĐ 100 tr Mua bỏ qua bước Giám đốc — Kế toán duyệt là xong]
- Kịch bản: khi sửa giá trị HĐ đang chờ từ 600 xuống 100 tr thì bước Giám đốc bị bỏ qua khi tới [test: e2e/journey-approval/cr121-d-journey.spec.ts » 5 · công ty 1: sửa giá trị HĐ đang chờ 600 → 100 tr ⇒ bước Giám đốc bị bỏ qua khi tới]
- Kịch bản: khi công ty 2 được gán quy trình một bước Giám đốc thì cả HĐ 600 tr và 100 tr chỉ qua Giám đốc [test: e2e/journey-approval/cr121-d-journey.spec.ts » 6 · công ty 2: chỉ một bước Giám đốc, không phụ thuộc giá trị (600 tr và 100 tr)]
- Kịch bản: khi admin mở Chi tiết lượt chạy thì thấy bước Giám đốc "bỏ qua" và nhật ký [test: e2e/journey-approval/cr121-d-journey.spec.ts » 7 · admin: 'Chi tiết lượt chạy' của HĐ đã sửa giá trị hiện đúng bước (Giám đốc: bỏ qua) và nhật ký]
- Kịch bản: khi người công ty 1 đọc HĐ công ty 2 thì bị từ chối và danh sách không lộ [test: e2e/journey-approval/cr121-d-journey.spec.ts » 8 · công ty 1 không thấy dữ liệu công ty 2]

## Việc còn lại
Chạy lại job `journey-approval` một lượt (ca 5, 7, 8 sửa sau lượt 2; ca 1–4, 6 đã xanh).
