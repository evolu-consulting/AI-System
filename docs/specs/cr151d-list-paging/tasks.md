# cr151d-list-paging — CR-151 (mọi danh sách người dùng thấy phải tải dần hoặc phân trang, cả API lẫn UI) · lát d

## Plan
Bảng rà soát `docs/specs/cr151-list-paging/audit.md`. Lát này làm mục 12 và phần «lịch sử» của mục 21. Khuôn như cr151c: limit+1, `next_offset`, nút «Xem thêm».

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 12 | `GET /partners/contracts?party&limit&offset` (mặc định 50, trần 200, quá trần ⇒ 400) trả `{items,next_offset}`; tab «Hợp đồng» của đối tác tải dần + «Xem thêm» | `partner-roles.ts` (contracts), `partner-roles.{repo,routes,ports,usecase}`, `features/partners/{api,hooks/use-partner-rep,components/ContractsTab}` | [x] |
| 21a | `GET /contracts/:id/history?limit&offset` (mặc định 50, trần 200, quá trần ⇒ 400) trả `{items,next_offset}`; «Lịch sử thay đổi» tải dần + «Xem thêm» | `manage.ts` (contracts), `activity.repo.ts`, `manage.{repo,routes,usecase}`, `contract-review/{api,hooks/use-manage,components/HistoryPanel}` | [x] |
| 21b | Mốc / phiên bản / sự kiện nằm trong cùng câu chi tiết HĐ (trần 200 / 100 / 50) | — | [ ] chưa làm |
| 22, 23, 24 | Chi tiết SP; công ty của mình; Hạn và nhắc việc | — | [ ] chưa làm |

## Quyết định trong lúc làm
- Mục 12, 21a đổi kiểu trả về từ mảng sang `{items,next_offset}` (một client duy nhất mỗi route) — giống nhật ký sửa ở cr151c.
- `record(ref, limit, offset = 0)` ở `activity.repo` giữ nguyên cho nơi gọi cũ (trợ lý, kiểm toán); `GetHistory` nhận `offset` tuỳ chọn.
- Bộ lọc giai đoạn ở tab «Hợp đồng» áp trên các dòng đã tải; số đếm theo giai đoạn cũng là của các dòng đã tải (còn «Xem thêm» thì chưa đủ).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/doi-tac-uy-tin.md

#### Yêu cầu: Tab «Hợp đồng» của đối tác tải dần ở máy chủ
- Kịch bản: khi xem trang 2 hợp đồng của đối tác thì mới cập nhật trước, không trùng, hết trang thì ít hơn limit, công ty khác không thấy [test: apps/hub-api/src/modules/packs/contracts/partner-contracts-paging.int.test.ts » trang 2 đúng thứ tự (mới cập nhật trước), không trùng trang 1, hết trang < limit]
- Kịch bản: khi xin quá 200 dòng hoặc offset âm thì bị từ chối [test: packages/contracts/src/pack-contracts/partner-roles.test.ts » trần 200: limit 201 lỗi, limit 200 đạt, offset âm lỗi]

### MODIFIED sht/chung-tu.md

#### Yêu cầu: Lịch sử thay đổi của hợp đồng tải dần ở máy chủ
- Kịch bản: khi xem trang 2 lịch sử thì mới nhất trước, không trùng, không sót, công ty khác không thấy [test: apps/hub-api/src/modules/packs/contracts/partner-contracts-paging.int.test.ts » trang 2 mới nhất trước, không trùng, limit+1 báo còn trang, hết trang < limit]

## Số câu SQL mỗi trang
- `GET /partners/contracts`, `/contracts/:id/history`: 1 câu/trang (limit+1) + câu quyền của uow như cũ.

## Việc còn lại
- Mục 21b, 22, 23, 24 và các mục Thấp 25+ chưa làm (hết ngân sách gọi công cụ/test).
- Chưa có test UI cho «Xem thêm» (mục 12, 21a); int ở mức repo, chưa phủ vai HTTP (N2) — quyền đọc không đổi, vẫn qua `packGuard`.
- e2e chưa chạy.
