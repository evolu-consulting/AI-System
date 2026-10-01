# Readiness · M3-permissions

Mỗi lần chạy spec-readiness thêm một dòng (mới nhất ở trên). Báo cáo đầy đủ dán bên dưới dòng đó hoặc lưu file riêng. Câu trả lời của người dùng ở Gate ghi ở mục riêng phía dưới.

| Ngày | Kết quả | Chặn | Cao | Thấp | Ghi chú |
|---|---|---|---|---|---|
| (chưa chạy) | — | — | — | — | Spec tách 2026-10-02 (`status: draft`); chạy sau khi P1, P2, Q1 xong |

## Câu hỏi mới cần người dùng trả lời ở Gate (mặc định kèm theo)
Chưa được chấp nhận; xem `spec.md` §9 "Đề xuất của docs-architect".
1. **A2** Mức kiểm vế "≤ 5 giây" ở M3 = NOTIFY ≤ 1 s sau commit + dữ liệu `hub_ro` đúng; vế menu/`CMD_NOT_FOUND` của Hub chuyển M5 (ghi CR-015). Mặc định: đồng ý.
2. **A4** Câu modal xung đột: có `{user}` khi `updated_by` sẵn có (workflow/command/feature/group), không `{user}` cho user/tenant; bỏ "Lịch sử vẫn giữ v{n}" tới M4. Mặc định: như vậy (phương án thay: không `{user}` ở mọi nơi tới M4).
3. **A6** Cấp feature trực tiếp cho user chỉ có API, không UI. Mặc định: đồng ý.
4. **A11** Ô Groups trong drawer user chỉ đọc (lệch artboard `Users`). Mặc định: đồng ý.

## Đã đưa vào spec từ readiness 2026-10-01 (đã được người dùng chấp nhận)
#13 (bump + NOTIFY, sửa thành sau commit), #19 (batch grant), #30 (dán username), #34 (agent "Chưa khả dụng"), #38, #29, #16 (cascade, unique grant), #12 (AC góc Admin), #7, #17; CR-008, CR-011, CR-013.
