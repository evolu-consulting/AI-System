---
id: fix-cr190-recipient
lát: fix-cr190-recipient
cr: CR-190
làn: nhanh
migration: không
phụ thuộc: fix-cr190-group-open
---
## Plan (ngắn)
e2e lượt 4 đỏ phía người nhận. Gốc code: mặc định mở nhóm chốt lúc tải đầu ⇒ nhóm đang thu (không chưa đọc) nhận tin SAU đó vẫn thu, dòng người gửi không hiện (j18-tin-nhan, tin-nhan-anh, khung-chat). Sửa: mặc định chỉ đi một chiều (có chưa đọc ⇒ mở, không tự thu). Gốc test: danh-sach-trai giả định đúng «1» chưa đọc trong dữ liệu dùng chung; cr169 J3 kiểm dòng trước khi mở nhóm công ty (chip đã bỏ).

## Làm
- [x] `lib/collapse.ts` `freezeDefaults`: `mở = đã mở || có chưa đọc`; unit đỏ trước.
- [x] e2e `cr190/danh-sach-trai` (chưa đọc ≥ 1), `cr169/tin-nhan-cong-ty` J3 (mở nhóm rồi mới kiểm dòng).

## Không làm / Chạm
Chạm: `packages/messages-web/src/lib/collapse.{ts,test.ts}`, e2e hai file trên.

## Test tối thiểu
unit `lib/collapse.test.ts`; e2e do điều phối chạy.

## Quyết định trong lúc làm
- Người dùng tự thu thì lựa chọn đã nhớ vẫn thắng; nhóm chứa cuộc đang mở vẫn luôn mở.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED pack-contracts/tin-nhan-giao-dien.md
#### Yêu cầu: Màn «Tin nhắn» toàn màn, menu có số chưa đọc
Nhóm chưa chọn mở/thu: có chưa đọc (lúc tải đầu hoặc tin tới sau đó) ⇒ mở, hết chưa đọc không tự thu.
- Kịch bản: khi nhóm đang thu nhận tin mới thì mở ra, hết chưa đọc không tự thu [test: packages/messages-web/src/lib/collapse.test.ts » mặc định chỉ mở thêm, không tự thu: hết chưa đọc vẫn mở, nhóm thu có chưa đọc mới thì mở]

## Việc còn lại
