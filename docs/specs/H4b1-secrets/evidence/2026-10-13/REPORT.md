# UAT H4b-1 Secrets — 2026-10-13 (tenant evolu)

Người chạy: qc-uat (Sonnet) · Studio đăng nhập `platform/admin` · Evidence: commit 6ddbd5bd.

| Kịch bản | Kết quả |
|---|---|
| Tạo secret `provider_api_key`, `kh_api_key` | Đạt |
| `source_credential` — tab Studio chỉ đọc | Đạt |
| `source_credential` — tạo phía Admin | Không áp dụng (`/sources` chưa có UI tạo khoá) |
| Danh sách không lộ giá trị (DOM, response `/secrets`, log, audit) | Đạt |
| Xoay khoá v1 → v2 | Đạt |
| Xoá secret đang dùng (`kh-main`) bị chặn kèm "KnowledgeHub · kh-main" | Đạt |
| Phân trang | Không kiểm (trang 100 dòng, không đủ dữ liệu) |
| Chặn xoá `provider_api_key` đang dùng | Không kiểm (dev chưa có nơi dùng) |

## Lỗi
- Blocker: không. Major: không.
- Minor: toast xếp chồng đè nút Huỷ/Lưu của Sheet (`13-A-validate-duplicate.png`).

**Kết luận: Đạt.**

Vòng 2 (1f6e37f8, ảnh `r2/`): toast studio-web `top-center` không đè Huỷ/Lưu của Sheet trên desktop và mobile — Đạt. Xoá secret đang dùng nay chặn ngay bằng dialog "Không xoá được …"; trùng tên báo inline trong Sheet.
