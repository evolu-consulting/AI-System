---
id: cr144-evidence-dialog
cr: CR-144
lane: Sonnet (hộp «Xem» hồ sơ duyệt; không migration, không đổi quyền)
---
# CR-144 · Hồ sơ duyệt: xem người duyệt, chữ ký, tệp trong hộp — không phải tải về

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Hồ sơ duyệt cho xem chữ ký và tệp ngay trên trang
Mỗi dòng hồ sơ có chữ ký/tệp hiện nút «Xem» mở hộp: người duyệt (kèm «thay …» / «duyệt thay»), bước, thời điểm, quyết định, ý kiến; chữ ký hiện ngay; ảnh hiện ảnh, PDF hiện khung PDF, loại khác (docx, xlsx…) hiện tên tệp kèm link nhỏ «Tải về» (chỉ loại này; ảnh và PDF không có nút tải). Ngày giờ theo ngôn ngữ đang chọn. Tên và loại tệp lấy cùng câu lấy bằng chứng theo lô (không truy vấn theo từng tệp).
- Kịch bản: khi người đọc được hồ sơ thì hồ sơ trả kèm tên + loại của chữ ký và tệp, người được giao (không phải người tạo) cũng thấy, người chỉ xem không thấy [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-evidence-file.int.test.ts » người được giao duyệt không phải người tạo cũng thấy files]
- Kịch bản: khi mở hộp «Xem» thì chữ ký hiện bằng ảnh, PDF bằng khung, loại khác chỉ hiện tên [test: apps/workspace-web/src/features/contract-approval/components/EvidenceView.test.tsx » hộp Xem hiện người duyệt và chữ ký ngay, ảnh, PDF và tệp lạ]
- Kịch bản: khi phân loại tệp thì chỉ ảnh raster và PDF xem được, SVG/HTML là loại khác [test: apps/workspace-web/src/features/contract-approval/lib/evidence-kind.test.ts » chỉ ảnh raster và PDF xem được]

#### Yêu cầu: Tệp bằng chứng chỉ hiển thị nội tuyến khi là ảnh raster hoặc PDF
Tải tệp bằng chứng giữ quyền cũ (ai xem được hồ sơ mới lấy được tệp; người ngoài nhận 404). Thêm `?inline=1`: chỉ ảnh png/jpg/webp/gif và PDF trả `inline`; SVG, HTML và loại khác luôn `attachment`; luôn `nosniff`; khi inline thêm `content-security-policy: sandbox; default-src 'none'`.
- Kịch bản: khi xin inline thì ảnh raster và PDF trả inline, SVG/HTML/khác vẫn là attachment [test: apps/hub-api/src/modules/packs/contracts/adapters/evidence-disposition.test.ts » SVG và HTML luôn attachment dù inline]
- Kịch bản: khi gọi route thật thì PDF inline là inline, không inline là attachment, SVG vẫn attachment, người được giao lấy được, người ngoài 403 [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-evidence-route.int.test.ts » PDF inline là inline và không inline là attachment]
- Kịch bản: khi người chỉ xem hoặc công ty khác xin tệp thì không có gì [test: apps/hub-api/src/modules/packs/contracts/adapters/approval-evidence-file.int.test.ts » người chỉ xem không có files và công ty khác không thấy]

## Tasks
- [x] contract `files` (name, mime) trong bằng chứng hồ sơ; repo trả cùng câu theo lô
- [x] route `?inline=1` + helper `evidence-disposition`
- [x] EvidenceView + EvidenceDialog thay nút tải; unit
- [x] e2e j01 (viết, chưa chạy)

## Quyết định trong lúc làm
- `EvidenceNames` trả `{name, mime}`; PDF hồ sơ chỉ lấy `name` (một câu SQL chung).
- `files` là trường tuỳ chọn trong contract (người chỉ xem không có).
