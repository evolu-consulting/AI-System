# cr151c-list-paging — CR-151 (mọi danh sách người dùng thấy phải tải dần hoặc phân trang, cả API lẫn UI) · lát c

## Plan
Bảng rà soát `docs/specs/cr151-list-paging/audit.md`. Lát này làm mục 11, 15, 16, 20. Mục 12 (tab «Hợp đồng» của đối tác) và mọi file `features/partners/**` thuộc lát cr152c; form `contract-new` thuộc cr152d — không đụng. Mục 21, 22, 23, 24 chưa làm (xem «Việc còn lại»).

## Làm
| # | Việc | File | Xong |
|---|---|---|---|
| 11 | `GET /obligations?limit&offset` (limit ≤ 500, bỏ trống = 500 như trước); sổ đối tác xin cỡ trang + 1 (limit+1), «Xem thêm» | `ledger.ts` (contracts), `ledger-read.repo.ts`, `ledger.ports.ts`, `features/ledger/{api,hooks/use-ledger,components/PartnerLog}` | [x] |
| 15 | Dòng giá/nguồn hàng của HĐ: API đã có `page/page_size/total`; UI tải dần theo trang (không chỉ trang 1), «Xem thêm» | `use-sourcing.ts`, `ContractSourcing.tsx` | [x] (chưa có test UI) |
| 16 | `GET /open-milestones?limit&offset` (≤ 500, thêm `o.id` làm khoá phụ để trang ổn định); `fetchOpenMilestones` gom mọi trang ở `contract-new/api.ts` — không đụng form | `deals.ts` (contracts), `open-milestones.repo.ts`, `contract-new/api.ts` | [x] (chưa có test UI) |
| 20 | `GET /contracts/:id/edit-log?limit&offset` (mặc định 50, trần 500, quá trần ⇒ 400) + `next_offset` (limit+1); «Xem thêm» | `deals.ts`, `deals.repo.ts`, `deals.routes.ts`, `transactions.mount.ts`, `promote-deal/{api,EditLogPanel}` | [x] |
| 21 | Chi tiết HĐ: lịch sử/mốc/phiên bản/sự kiện | — | [ ] chưa làm |
| 22 | Chi tiết SP | — | [ ] chưa làm |
| 24 | Hạn và nhắc việc (Tổng quan) | — | [ ] chưa làm |
| 23 | Công ty của mình | — | [ ] chưa làm (client nằm trong `features/partners/**`, đang bị khoá) |

## Quyết định trong lúc làm
- Phân trang theo `offset`, khớp cr151b. Mục 11/16 giữ kiểu trả về mảng (nhiều nơi dùng: trợ lý, mốc HĐ) ⇒ không đổi hợp đồng cũ; client xin `limit` = cỡ trang + 1 để biết còn trang.
- Mục 20 đổi mặc định 500 → 50 + `next_offset` (không cắt im lặng; UI «Xem thêm»).
- Mục 16: form không đổi; hàm fetch gom trang tối đa 20 trang × 500.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/mot-moc-kho-cong-no.md

#### Yêu cầu: Đợt mở của sổ đối tác, mốc mở khi tạo giao dịch và nhật ký sửa phân trang ở máy chủ
- Kịch bản: khi xem trang 2 đợt mở thì đúng thứ tự, không trùng, hết trang thì ít hơn limit, công ty khác không thấy [test: apps/hub-api/src/modules/packs/contracts/list-paging.int.test.ts » mục 11 đợt mở: trang 2 đúng thứ tự, không trùng, limit+1 báo còn trang, công ty khác không thấy]
- Kịch bản: khi xem trang 2 mốc mở thì không trùng trang 1, công ty khác không thấy [test: apps/hub-api/src/modules/packs/contracts/list-paging.int.test.ts » mục 16 mốc mở: trang 2 không trùng trang 1, công ty khác không thấy]
- Kịch bản: khi xem trang 2 nhật ký sửa thì mới nhất trước, không trùng, công ty khác nhận không tìm thấy [test: apps/hub-api/src/modules/packs/contracts/list-paging.int.test.ts » mục 20 nhật ký sửa: limit+1 + offset, mới nhất trước, không trùng, công ty khác ⇒ null]

## Số câu SQL mỗi trang
- `GET /obligations`, `/open-milestones`: 1 câu/trang (limit tới limit+1 do client xin) + câu quyền của uow như cũ.
- `GET /contracts/:id/edit-log`: 1 câu/trang (limit+1).
- `GET /sourcing?contract=`: như cũ (1 câu đọc cố định, cắt trang ở bộ nhớ); mỗi «Xem thêm» thêm một lời gọi.

## Việc còn lại
- Mục 21, 22, 24 chưa làm (hết ngân sách); mục 23 bị khoá bởi lát cr152c (client trong `features/partners/**`); mục 12 ngoài phạm vi.
- Chưa có test unit/e2e cho nút «Xem thêm» (mục 11, 15, 20) và vòng gom trang mục 16; int mới là mức repo, chưa phủ vai HTTP (N2: người được giao ≠ người tạo) — quyền đọc không đổi, vẫn qua `packGuard`.
- Mục 15: `ITEMS_MAX 500` dòng hàng/HĐ ở `sourcing.repo.ts` vẫn là trần cố định.
- e2e chưa chạy.
