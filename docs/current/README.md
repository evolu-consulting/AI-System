# docs/current — hành vi ĐANG chạy

Mục đích: một chỗ sạch mô tả **hệ thống làm gì ngay bây giờ** (trên `platform/gd0`), để agent đọc thay vì lần qua nhiều spec/CR cũ. Đây là nguồn sự thật cho agent khi hỏi "hành vi hiện hành là gì". Không ghi kế hoạch, không ghi lịch sử.

- **Lịch sử và lý do** nằm ở `docs/CHANGE-REQUESTS.md` (CR) và `docs/specs/<lát>/tasks.md` (quyết định trong lúc làm). Mỗi mục ở đây ghi nguồn (lát/CR) để truy ngược.
- **Spec thắng (như OpenSpec).** Đây là hành vi đã duyệt; chỉ đổi qua Delta của lát hoặc CR. Code lệch ⇒ không tự sửa bên nào: đánh dấu `⚠ Lệch code: <file:dòng>` tại mục và đưa vào báo cáo cuối đợt để người dùng chốt (lỗi ⇒ sửa code; quyết định mới ⇒ Delta/CR). Chỗ chưa kiểm được ghi ở mục "Chưa rõ" cuối file, không đoán.
- Ngoại lệ một lần: bản đầu (2026-10-27) được viết ngược từ code, nên phản ánh code tại thời điểm đó.
- **Cách cập nhật:** mỗi lát có mục `## Delta (so với docs/current)` trong `tasks.md`; cuối đợt `docs-architect` gộp Delta vào đây và đánh dấu lát đã gộp (`docs/WORKFLOW.md` "Gộp docs/current cuối đợt"). Không sửa tay giữa đợt trừ khi sửa lỗi sự thật.
- File ≤ 400 dòng; dài hơn thì tách theo khu vực.

## Định dạng Delta (ADR-0032)
Trong `## Delta (so với docs/current)` của `tasks.md`:
```
Trạng thái gộp: chưa gộp            (sau gộp: đã gộp YYYY-MM-DD (đợt <tên>))

### MODIFIED sht/chung-tu.md          (hoặc ADDED <file mới> / REMOVED <file>)
#### Yêu cầu: Mở lại chứng từ
Người phụ trách hoặc owner được mở lại.
- Kịch bản: khi người phụ trách bấm "Mở lại" thì chứng từ về Nháp [test: e2e/sht/mo-lai.spec.ts » mở lại về Nháp]
```
- Mỗi khối `###` trỏ **một file trong `docs/current`** (đường dẫn tương đối). MODIFIED/REMOVED yêu cầu file đã có; ADDED được tạo file mới.
- Mỗi `#### Yêu cầu: <tên>` (ADDED/MODIFIED) có mô tả và **≥ 1** dòng `- Kịch bản: khi … thì …`. REMOVED chỉ cần dòng `Lý do: …`.
- Mỗi `- Kịch bản:` (ADDED/MODIFIED, lát "chưa gộp") kết thúc bằng `[test: <đường dẫn từ gốc repo>]` hoặc `[test: <đường dẫn> » <đoạn tiêu đề test>]` (nhiều mục cách nhau `;`); không có test tự động thì `[test: thủ công — <lý do>]`. `openspec:check` kiểm file tồn tại và tiêu đề có trong file (tìm văn bản, không chạy test); lát "đã gộp" không kiểm lại.
- Lát không đổi hành vi (hạ tầng/test/nhãn): thay các khối bằng đúng một dòng `Không thay đổi hành vi (lý do: …)`.
- Lệnh: `bun run openspec:check [lát…]` (kiểm; `slice:merge` tự chạy), `bun run openspec:pending` (lát chưa gộp + file đích, dùng khi gộp cuối đợt), `bun run openspec:archive <lát> [--dot <tên>]` (chỉ ghi sổ "đã gộp"; việc gộp văn xuôi vào đây vẫn do docs-architect).

Viết tắt đường dẫn: `H` = `apps/hub-api/src/modules/packs/contracts`, `W` = `apps/contracts-web/src`, `C` = `packages/contracts/src/pack-contracts`, `MG` = `packages/db/migrations-pack-contracts`, `T` = `tests/acceptance`.

## Mục lục

| Khu vực | File | Nội dung |
|---|---|---|
| Sổ Hợp Tác (app `contracts`) | [sht/chung-tu.md](sht/chung-tu.md) | 3 loại chứng từ, phiên bản, mở lại, phụ lục chỉ đọc, xoá, danh sách |
| | [sht/mot-moc-kho-cong-no.md](sht/mot-moc-kho-cong-no.md) | Mốc, giao theo %, vượt tồn, xác nhận + xem trước tác động |
| | [sht/duyet-ky-so.md](sht/duyet-ky-so.md) | Quy trình duyệt (máy 2 bước / engine), khoá, ký số |
| | [sht/doi-tac-uy-tin.md](sht/doi-tac-uy-tin.md) | Điểm uy tín (HD8 / V2-E theo cờ), cờ đỏ, xem trước chuyển engine |
| | [sht/sp-va-gia.md](sht/sp-va-gia.md) | SP & Giá: giá có VAT/hạn, thay/gỡ mềm, Lịch sử giá, nguồn Báo giá |
| | [sht/cai-dat-va-quyen.md](sht/cai-dat-va-quyen.md) | Vai/quyền, màn Cài đặt, cờ và công tắc |
| | [sht/phap-ly-va-can-xu-ly.md](sht/phap-ly-va-can-xu-ly.md) | Cảnh báo pháp lý, nguồn Cần xử lý |

| Community (gói `community`) | [community/README.md](community/README.md) | Nghiệp vụ, ma trận hiển thị, Chưa rõ (CR-102) |
| Engine quy trình (CR-103) | [engine/flow-engine.md](engine/flow-engine.md) | Registry node, If, set, đổi node, canvas/drawer, showcase, route HUB_PROCESS_ROUTES, catalog tool |
| Admin (ngắn) | [admin/ghi-chu.md](admin/ghi-chu.md) | Người dùng ngoài / công ty đối tác, cổng admin-api cho đối tác |

Khu vực khác (Agent Hub lõi, Worker, Chat) chưa có `current/`; dùng `docs/design/**` + CODEMAP tới khi có.
