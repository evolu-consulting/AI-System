# docs/current — hành vi ĐANG chạy

Mục đích: một chỗ sạch mô tả **hệ thống làm gì ngay bây giờ** (trên `platform/gd0`), để agent đọc thay vì lần qua nhiều spec/CR cũ. Đây là nguồn sự thật cho agent khi hỏi "hành vi hiện hành là gì". Không ghi kế hoạch, không ghi lịch sử.

- **Lịch sử và lý do** nằm ở `docs/CHANGE-REQUESTS.md` (CR) và `docs/specs/<lát>/tasks.md` (quyết định trong lúc làm). Mỗi mục ở đây ghi nguồn (lát/CR) để truy ngược.
- **Spec thắng (như OpenSpec).** Đây là hành vi đã duyệt; chỉ đổi qua Delta của lát hoặc CR. Code lệch ⇒ không tự sửa bên nào: đánh dấu `⚠ Lệch code: <file:dòng>` tại mục và đưa vào báo cáo cuối đợt để người dùng chốt (lỗi ⇒ sửa code; quyết định mới ⇒ Delta/CR). Chỗ chưa kiểm được ghi ở mục "Chưa rõ" cuối file, không đoán.
- Ngoại lệ một lần: bản đầu (2026-10-27) được viết ngược từ code, nên phản ánh code tại thời điểm đó.
- **Cách cập nhật:** mỗi lát có mục `## Delta (so với docs/current)` trong `tasks.md`; cuối đợt `docs-architect` gộp Delta vào đây và đánh dấu lát đã gộp (`docs/WORKFLOW.md` "Gộp docs/current cuối đợt"). Không sửa tay giữa đợt trừ khi sửa lỗi sự thật.
- File ≤ 400 dòng; dài hơn thì tách theo khu vực.

Viết tắt đường dẫn: `H` = `apps/hub-api/src/modules/packs/contracts`, `W` = `apps/contracts-web/src`, `C` = `packages/contracts/src/pack-contracts`, `MG` = `packages/db/migrations-pack-contracts`, `T` = `tests/acceptance`.

## Mục lục

| Khu vực | File | Nội dung |
|---|---|---|
| Sổ Hợp Tác (app `contracts`) | [sht/chung-tu.md](sht/chung-tu.md) | 3 loại chứng từ, phiên bản, mở lại, phụ lục chỉ đọc, xoá, danh sách |
| | [sht/mot-moc-kho-cong-no.md](sht/mot-moc-kho-cong-no.md) | Mốc, giao theo %, vượt tồn, xác nhận + xem trước tác động |
| | [sht/duyet-ky-so.md](sht/duyet-ky-so.md) | Quy trình duyệt (máy 2 bước / engine), khoá, ký số |
| | [sht/doi-tac-uy-tin.md](sht/doi-tac-uy-tin.md) | Điểm uy tín (HD8 / V2-E theo cờ), cờ đỏ, xem trước chuyển engine |
| | [sht/cai-dat-va-quyen.md](sht/cai-dat-va-quyen.md) | Vai/quyền, màn Cài đặt, cờ và công tắc |
| | [sht/phap-ly-va-can-xu-ly.md](sht/phap-ly-va-can-xu-ly.md) | Cảnh báo pháp lý, nguồn Cần xử lý |

Khu vực khác (Admin, Agent Hub, Worker, Chat) chưa có `current/`; dùng `docs/design/**` + CODEMAP tới khi có.
