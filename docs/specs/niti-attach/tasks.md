---
id: niti-attach
title: Importer I1 — chạy lại `--filebox` gắn file vào HĐ đã nhập không file
cr: CR-095
lane: đầy đủ (chuyển dữ liệu khách)
---
# niti-attach (plan ngắn)

Người dùng (2026-10-20): nhập dữ liệu sohoptac trước, KHÔNG file (sohoptac2 chưa có FileBox); khi có FileBox chạy lại `--filebox`
phải gắn file vào đúng HĐ đã nhập.

- `application/files.ts` (tách khỏi use case): đọc trạng thái đích MỘT câu mỗi tenant (`contractFiles`: HĐ có chưa, `file_id`, hàng
  file của lần nhập có chưa) ⇒ HĐ đã có file ⇒ bỏ (không tải, không đè) · không kho đích/dry-run ⇒ `pending` · HĐ mới ⇒ như cũ
  (hàng file theo lô trước HĐ) · HĐ đã nhập chưa file ⇒ tải lên rồi `attachFiles` (MỘT câu: chèn `contracts.files` + gắn `file_id`
  khi còn null; hàng file đã có từ lượt đứt ⇒ chỉ gắn).
- Báo cáo thêm `files: {jobs, has_file, uploaded, attached, pending}`. Đối soát sha256 đọc lại giữ nguyên.
- Int `tests/acceptance/NITI/attach.int.test.ts`: lượt không file (pending 1) ⇒ `--filebox` (uploaded 1, attached 1, mở qua
  `GET /pack/contracts/contracts/:id/file`, sha khớp, 0 hàng khác) ⇒ chạy lại (0 upload, 0 gắn). evotest: 19/19 (NITI + I1).
