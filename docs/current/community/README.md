# docs/current/community — Community App (gói `community`)

Trạng thái: **đã duyệt (CR-102) và đã code xong C1–C12 trên `platform/gd0` (c2d8eebf, gộp 2026-10-28); chưa deploy production.** Mã: `apps/community-web`, `packs/community` (hub-api), `@ai/contracts/community`, migration community 0001–0005. Lịch sử và lý do: `docs/CHANGE-REQUESTS.md` (CR-102, 102a, 102b), intake `docs/intake/community/2026-10-28-intake.md`, nguồn gốc `docs/intake/community/source-pdf.txt` (PDF "Community App · Nghiệp vụ" 28/10/2026). Prototype quy tắc (chỉ tham chiếu): https://claude.ai/artifact/44Chh4usAaK8gGzwtY72ZC.

Quy ước chung: xem `docs/current/README.md` (file ≤ 400 dòng, Spec thắng, nguồn ở mỗi mục). Mã `R<n>` = ý thứ n trong bảng Intake; `D1–D5` = quyết định người dùng 2026-10-28 (D1 đối tác = user ngoài trong tenant chủ quản; D2 người xem do chủ quản chọn, trần = bạn bè; D3 luồng bình luận theo bài × công ty đối tác; D4 che liên hệ lúc ghi; D5 chỉ một cổng ghi vào SHT).

**Dữ liệu seed/test:** tenant `demo` (Công ty demo): `demo-owner` Nguyễn Văn An = Admin chủ quản, `demo-editor` Lê Quốc Cường = Thành viên chủ quản. SP có sẵn trong SHT: Băng keo 5cm, Thùng phi 200L (NCC Cơ sở Tân Phát), Chữ ký số DN – USB Token, Chữ ký số HSM (Hãng NCCA), Hoá đơn điện tử (Viettel S-Invoice). Không dùng tenant NITI.

**Giao diện:** theo mockup Community của người dùng (chờ ảnh). Tới khi có, nền thị giác = thiết kế `apps/contracts-web`. Riêng bảng tin và thẻ bài đã redesign Phase A (`styles/feed.css`, màu theo loại bài) — bố cục ở [hien-thi.md](hien-thi.md) mục 0.

## Mục lục
| File | Nội dung |
|---|---|
| [nghiep-vu.md](nghiep-vu.md) | Vai, mạng hình sao, loại bài, người xem (D2), luồng riêng (D3), che liên hệ (D4), Lưu báo giá (R15–R28), thông báo, chatbot, ngoài phạm vi, Chưa rõ |
| [hien-thi.md](hien-thi.md) | Bố cục bảng tin (mục 0, Phase A redesign: 2 cột, rail theo vai, tab sticky, thẻ bài theo loại); ma trận hiển thị R8 dạng bảng CA TEST đánh số (người xem × nội dung × kết quả), Chưa rõ |

Liên quan: ADR-0031 (cổng gói↔gói), `docs/platform/pack-boundary.md`, `docs/specs/com-c*/tasks.md` (kế hoạch lát C1–C12).
