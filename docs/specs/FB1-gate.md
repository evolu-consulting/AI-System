# Gate FB1 FileBox driver Storage (đính kèm hội thoại + phòng/nhóm) — 2026-10-15

**Kết quả: DUYỆT (người dùng chấp nhận).** Trình người dùng theo Luật 2b (ADR dịch vụ mới + hard stop) — đã duyệt.
- spec-readiness: READY (0 Chặn / 0 Cao / 2 Thấp) — `specs/FB1-filebox-attachments/readiness.md`.
- Người dùng chấp nhận:
  - (a) ADR-0015 chuyển Accepted: nhận FileBox làm dịch vụ lưu file ngoài, thay driver local.
  - (b) HS2: thu hẹp egress còn chỉ `149.202.83.5:9443` (bỏ `:9000`), siết hơn ADR-0015 D6 gốc.
  - (c) HS1 giữ làm hard stop phía người dùng: nạp `FILEBOX_URL`/token thật + `filebox.crt` + mở firewall `149.202.83.5:9443` + smoke thật = phần "retest" sau BUILD.
  - (d) Ghi nhận cờ security review egress/secret (token cache memory-only) chạy sau BUILD.
- Phạm vi build: B0–B9 + F1–F6; 82 test qua mock FileBox (`specs/FB1-filebox-attachments/test-plan.md`).
- 2 Thấp theo dõi: security-review token cache; câu chữ §3.6 d128.
- CR liên quan: CR-076…079. ADR: [0015](../adr/0015-filebox-external-file-storage.md).
