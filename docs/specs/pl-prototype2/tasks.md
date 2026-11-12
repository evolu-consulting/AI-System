---
id: pl-prototype2
lát: pl-prototype2
cr:
làn: nhanh
migration: không
phụ thuộc: pl-prototype
---
## Plan (ngắn)
Biến bản mẫu thành cách chính để người nghiệp vụ chốt tính năng trước khi code, và đưa câu trả lời của họ về spec + test.
Vòng lặp: dựng → người duyệt bấm thử + trả lời → «Xuất góp ý» → `proto:feedback` → `proto:scenarios` → chia lát.

## Làm
- [x] Chế độ góp ý trong HTML: Đúng ý / Cần sửa + ghi chú mỗi màn; `questions[]` thành thẻ một chạm; đếm «Còn N câu…»; «Xuất góp ý» (tệp JSON + chữ để dán chat; có phiên bản băm).
- [x] Sơ đồ luồng làn bơi (SVG, sáng/tối) + «Đi thử từng bước» (đổi vai tự động, banner «Bây giờ là: …»).
- [x] Khối mới: tab, hộp xác nhận, thẻ việc, nhãn trạng thái, trang trống, thông báo, ô số; chuyển Máy tính / Điện thoại (375).
- [x] CLI: `proto:build` (kiểm goto, vai, số màn 8/12, từ kỹ thuật), `proto:feedback` (từ chối bản cũ), `proto:scenarios`. Luật thuần ở `tools/prototype/*.rules.ts`.
- [x] Ví dụ `docs/specs/pl-prototype/prototype.json` dùng câu hỏi, trạng thái, luồng; SKILL.md + dev-flow §9.

## Không làm / Chạm
Chỉ `tools/prototype/`, `package.json` (2 lệnh), skill prototype, `dev-flow.md` §9, ví dụ. Không chạm code sản phẩm, không thêm thư viện.

## Test tối thiểu
`bun test tools/prototype` (unit; hàm của script nhúng test qua `new Function`, không cần trình duyệt).

## Quyết định trong lúc làm
- Không có happy-dom/linkedom trong lockfile ⇒ test chuỗi HTML + hàm thuần của script nhúng (`client.ts` xuất `PURE_JS`).
- Phiên bản góp ý = băm FNV-1a của bản mẫu đã chuẩn hoá; đổi bất kỳ chữ nào ⇒ góp ý cũ bị từ chối.
- Giới hạn màn hình chuyển từ lược đồ sang `proto:build`: cảnh báo > 8, lỗi > 12.
- «Gợi ý» của câu hỏi chỉ đánh dấu, không tính là đã trả lời.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: công cụ dây chuyền)

## Việc còn lại
- Chưa kiểm trong trình duyệt thật: bấm chuột, localStorage, tải tệp, sao chép, hiển thị sáng/tối và 375px.
