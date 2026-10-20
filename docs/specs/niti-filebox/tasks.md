---
id: niti-filebox
title: Importer I1 — file HĐ vào FileBox (org t_<tenant>) như upload của app
cr: CR-095
lane: đầy đủ (chuyển dữ liệu khách) — một agent, test int trên evotest
depends: I1, niti-onboard, FB1/PK-FR-06 (FileBox của gói)
---
# niti-filebox (plan ngắn)

`mgmt-import --filebox` (env `FILEBOX_URL`, `FILEBOX_TOKEN`, `[FILEBOX_CA]` — cùng biến hub-api dùng cho gói): file trong
`contract_files/<org>/<hđ>/` ⇒ `POST /files?org=t_<tenant>&name=` (không retry) ⇒ hàng `contracts.files` (org, file_id, version_id)
⇒ app mở bằng route thường `GET /pack/contracts/contracts/:id/file` (302 link FileBox). Đối soát đọc lại bytes (`GET
/files/{id}/content`) theo org của hàng ⇒ sha256 khớp, kể cả khi chạy lại (không upload lại vì hàng file đã có).

| # | Việc | Trạng thái |
|---|---|---|
| 1 | `adapters/filebox.http.ts` (client thu gọn, cùng hợp đồng hub-api) + `createFileboxSink` đọc lại theo org + CLI `--filebox` | xong |
| 2 | Unit `filebox.http.test.ts` + int `tests/acceptance/NITI/filebox.int.test.ts` (hub-api thật + FileBox giả) | xong |

## Quyết định
- D-NF-01: admin-api không import được mã hub-api ⇒ client FileBox thu gọn riêng (POST/GET content/DELETE); gộp vào package chung = nợ.
- D-NF-02: Văn bản ký số (`signed_docs`): mgmt-app KHÔNG lưu bytes (chỉ metadata + sha256), bảng đích cũng không có cột file ⇒ không
  có gì để đưa vào FileBox; đối soát giữ theo sha256.
- D-NF-03: `--filebox` và `--sink-dir` loại trừ nhau (`SINK_CONFLICT`). FileBox lỗi ⇒ `FILEBOX_UNAVAILABLE` (exit 1), chạy lại an toàn.

## Còn lại
- Upload thành công nhưng ghi lô `contracts.files` lỗi ⇒ file mồ côi ở FileBox (chạy lại upload bản mới) — chấp nhận cho lượt một lần.
- sohoptac2 hiện KHÔNG cấu hình FileBox (`HUB_ATTACH_DRIVER=local`, không `FILEBOX_*`) ⇒ app chưa mở được file HĐ nào; cần cấu hình
  trước khi nhập file.
