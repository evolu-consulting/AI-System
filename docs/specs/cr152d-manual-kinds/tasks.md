# cr152d-manual-kinds — CR-152: nhập tay HĐ Nhượng quyền / Thỏa thuận hợp tác

id: cr152d-manual-kinds · cr: CR-152 · làn: backend (+ lớp thân form) · phụ thuộc: cr152a, cr152b

## Làm
| # | Việc | File |
|---|---|---|
| 1 | `ManualContractRequestSchema`: `deal` đủ 5 loại, thêm `kind_terms` (strict theo loại; loại khác gửi ⇒ 400); `kindTermsMissing` chuyển về `@ai/contracts` (một nguồn) | `packages/contracts/src/pack-contracts/{extract,kind-terms,deals}.ts` |
| 2 | Route: thiếu trường bắt buộc ⇒ 422 `KIND_TERMS_INCOMPLETE` + `details.missing`; use case chuẩn hoá + hướng tiền theo vai; repo ghi `kind_terms` cùng câu tạo HĐ rồi gọi hook mốc kỳ cr152a (cùng tx, idempotent) | `adapters/extraction.routes.ts`, `application/create-manual.usecase.ts`, `adapters/extraction.repo.ts` |
| 3 | Thân form: `kindTermsBody` (ô rỗng/ẩn bỏ) | `contract-form/lib/form-model.ts` |

## Quyết định trong lúc làm
- Mã lỗi: sai kiểu / khoá lạ / % ngoài khoảng ⇒ 400 (chuẩn zod của nền tảng, như `PUT kind-terms`); thiếu trường bắt buộc ⇒ 422 kèm danh sách khoá (không lẫn với 400).
- `direction` của HĐ hai loại luôn theo vai trong `kind_terms` (bên nhận quyền ⇒ mua vào); `direction` gửi lên bị bỏ qua.
- `POST /contracts/manual` vẫn trả 410 theo mặc định (CR-097, `manualEnabled`) và `/contracts/new` vẫn chỉ tải file: chưa có trang nhập tay để gắn `KindTermsFields`; lớp thân form + `DealTiles kinds` đã sẵn để gắn khi bật lại.

## Việc còn lại
- Gắn `KindTermsFields` + `DealTiles kinds` vào trang nhập tay khi CR-097 cho bật lại; điểm uy tín: cr152c.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED sht/loai-hd-nhuong-quyen-hop-tac-nhap-tay.md

#### Yêu cầu: Nhập tay Nhượng quyền / Hợp tác
Khi nhập tay HĐ Nhượng quyền hoặc Hợp tác, hệ thống lưu trường riêng cùng lúc tạo HĐ rồi sinh mốc từng kỳ như khi HĐ vào hiệu lực; thiếu trường bắt buộc của loại thì không tạo và báo rõ trường thiếu.
- Kịch bản: khi nhập tay Nhượng quyền theo % doanh thu thì HĐ có trường riêng và mốc từng kỳ [test: apps/hub-api/src/modules/packs/contracts/manual-kinds.int.test.ts » Nhượng quyền % doanh thu ⇒ HĐ done + kind_terms + mốc kỳ]
- Kịch bản: khi bên nhận quyền nhập tay thì hướng tiền là mua vào [test: apps/hub-api/src/modules/packs/contracts/manual-kinds.int.test.ts » bên nhận quyền ⇒ direction purchase theo vai]
- Kịch bản: khi thiếu trường bắt buộc thì báo lỗi kèm khoá thiếu và không tạo HĐ [test: apps/hub-api/src/modules/packs/contracts/manual-kinds.int.test.ts » thiếu trường bắt buộc ⇒ 422 KIND_TERMS_INCOMPLETE + khoá thiếu, không tạo HĐ]
- Kịch bản: khi Hợp tác không chia thì chỉ có nhắc gia hạn [test: apps/hub-api/src/modules/packs/contracts/manual-kinds.int.test.ts » Hợp tác «không chia» ⇒ chỉ nhắc gia hạn, không mốc kỳ]
- Kịch bản: khi người chỉ đọc nhập tay thì bị từ chối, tenant khác không thấy HĐ [test: apps/hub-api/src/modules/packs/contracts/manual-kinds.int.test.ts » N2 + chéo tenant: editor chỉ đọc ⇒ 403, tenant B tạo HĐ riêng, A không thấy]
- Kịch bản: khi form gửi Nhượng quyền thì thân có trường riêng, loại khác không có [test: apps/workspace-web/src/features/contract-form/lib/form-model.test.ts » Nhượng quyền: gửi ô có giá trị (số/đúng kiểu), bỏ ô rỗng, loại khác không gửi]
