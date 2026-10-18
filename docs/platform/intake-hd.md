# Intake gói hợp đồng (mgmt-app) — quyết định 2026-10-18

CR: [CR-094](../CHANGE-REQUESTS.md). Nguồn: Intake Đầy đủ, người dùng chốt 2026-10-18. Spec N1/HD1… trỏ về file này.
Mã tham chiếu mgmt-app: `reference/mgmt-app-contracts/api/app/contracts/{fields,ingest,verify,remind,project,link,manual,schedule}.py`, `ledger/*`, `scoring/*`, `assistant/*`, `web/src/pages/*`.

## Quyết định
- Mục tiêu: **lõi nền tảng dùng chung** + mgmt-app là **app mẫu đầu tiên**, đủ tính năng mgmt-app hiện tại, trình diễn được các flow. Đã có khách thật ⇒ phải chuyển khách + dữ liệu.
- **GĐ1 ∥ GĐ2**: kéo dịch vụ tri thức (ADR-0021), định danh chung (ADR-0018), hạ tầng production chịu lỗi (ADR-0020) lên GĐ1. Luồng A (lõi N1–N7) ∥ Luồng B (app mẫu HD1–HD10).
- AI của gói (trích trường, kiểm, trợ lý) chạy bằng **agent Claude trong Hub**, không qua Dify (Dify giữ vai ADR-0022 cho phần đang có).
- Trợ lý chat: **một trợ lý chung trong Agent Hub**; gói chỉ thêm bộ tool hợp đồng (MCP) + nhúng khung chat vào app hợp đồng (mở từ màn hợp đồng có ngữ cảnh). Không tạo agent riêng.
- ADR-0016, 0018, 0021 ⇒ **Accepted** (2026-10-18).
- Tự quyết (Luật 2): backend gói TS/Hono (không giữ Python); hạn chót tính ở gói; nhắc hạn bằng vòng nền theo tập (không `wait_until` mỗi HĐ).

## 15 câu và trả lời
| # | Câu | Trả lời |
|---|---|---|
| 1 | Duyệt GĐ1 | AI đọc → người phụ trách kiểm/sửa → giá trị ≥ ngưỡng ⇒ cấp 2 duyệt → "Đã duyệt" → theo dõi hạn (mặc định) |
| 2 | Bản đưa vào duyệt | Bản cuối/đã ký; dự thảo/so phiên bản ngoài phạm vi (mặc định) |
| 3 | Ngưỡng + nhóm | Một ngưỡng 500.000.000 đ trong luật rẽ nhánh def; cấp 1 Group "Phụ trách HĐ", cấp 2 "Ban giám đốc" (mặc định) |
| 4 | Từ chối | Có: bắt buộc lý do, kết thúc run, HĐ "Bị từ chối"; "Chưa đạt" = trả về sửa (mặc định) |
| 5 | Người tải lên | Được duyệt cấp 1, không cấp 2 (mặc định) |
| 6 | **Đảo** | Đủ tính năng mgmt-app: trạng thái theo ngày, nhắc hạn 60/30/7/1/0 (in-app + email + push web), kết quả xử lý, lịch thanh toán/sổ nghĩa vụ/quá hạn, điểm đối tác, so sánh giá/biên lãi, CKS, trợ lý chat |
| 7 | **Đảo** | Chuyển dữ liệu khách thật theo 6 bước ADR-0016 (dựng bảng → ghi kép → nạp cũ → đối soát 100% 7 ngày → chuyển đọc → tắt ghi cũ); mgmt-app chạy song song tới khi chuyển xong |
| 8 | Trần run | Cấu hình theo tenant (mặc định 5, khách GĐ1 200), `waiting_review` vẫn đếm (mặc định) |
| 9 | **Đảo** | Phụ lục gắn HĐ gốc (chọn tay + AI gợi ý) và áp giá mới thay giá cũ từ ngày hiệu lực |
| 10 | **Đảo** | Tra MST Cục Thuế (tồn tại, hoạt động, khớp tên) — dịch vụ ngoài, thêm egress |
| 11 | Đăng nhập | Qua admin-api (ADR-0018); owner/editor/viewer → 3 Group (mặc định) |
| 12 | Tenant khách | Chạy bằng API key, không subscription (ADR-0019 §3) (mặc định) |
| 13 | FileBox | Hardening `org` theo tenant ngay từ đầu (ADR-0015) (mặc định) |
| 14 | App web | Riêng cho gói, port component/màu mgmt-app, build **Rsbuild** theo ADR-0001 (không Vite) (mặc định) |
| 15 | **Đảo** | Nhập tay HĐ không có file (`manual.py:38-76`) |

## Kế hoạch lát
**Luồng A — lõi dùng chung** (viết để mọi app sau dùng lại)
| Lát | Nội dung |
|---|---|
| N1 | Khung gói: schema riêng mỗi gói + RLS + FK kép tenant, catalog quyền gói, FileBox org theo tenant, DOCX → text |
| N2 | Mở rộng engine: start run từ API gói (R14), kết quả Từ chối (R10), tool gói trong `/mcp` (R16; mở phần hoãn B6/HUB-BR-12/CR-087), trần run theo tenant (R15), luật người tải lên không duyệt cấp 2 (R13). Chạm P-d đã đóng ⇒ Gate lại phần chạm |
| N3 | Thông báo dùng chung: email + push web |
| N4 | Dịch vụ tri thức (gộp 2 RAG, ADR-0021): bước 0 **eval 0.11** (bộ câu hỏi tiếng Việt có đáp án, đo RAG mgmt-app và KnowledgeHub) → dựng từ pipeline mgmt-app, MCP `knowledge.search/get/add`, test chéo tenant → đo lại ≥ cả hai |
| N5 | Định danh chung (ADR-0018): chuyển tài khoản user mgmt-app (SSO OIDC vẫn GĐ2) |
| N6 | Khung chuyển dữ liệu (ADR-0016): ghi kép, đối soát |
| N7 | Hạ tầng production chịu lỗi (ADR-0020) trước khi chuyển khách thật |

**Luồng B — app mẫu mgmt-app**
| Lát | Nội dung |
|---|---|
| HD1 | Nền gói: bảng `contracts`, `contract_items`, `contract_reminders`, `contract_events` (+ tenant_id, RLS), API danh sách/chi tiết/sửa trường, file qua FileBox, DOCX → text; perf danh sách p95 ≤ 50 ms với 10.000 HĐ/tenant, số câu SQL cố định |
| HD2 | Đọc + kiểm: agent trích 23 trường kèm quote (prompt từ `extract.py`), port `verify.py` + test, tra MST, màn kiểm/sửa (R8), nhập tay |
| HD3 | Flow duyệt: def mẫu (input file → agent trích → gate cấp 1 → rẽ nhánh `total_value` → gate cấp 2 → tool gói ghi "Đã duyệt"/"Bị từ chối"), dùng N2 |
| HD4 | Sau duyệt: trạng thái theo ngày (múi giờ tenant), hạn chót = `end_date − notice_days`, vòng nhắc theo tập (lô 100 p95 ≤ 50 ms, 10.000 HĐ), kết quả xử lý, dùng N3 |
| HD5 | Danh sách + phụ lục: lọc/cột theo pattern mgmt-app, phụ lục gắn HĐ gốc, áp giá phụ lục |
| HD6 | Trợ lý: tool MCP hợp đồng cho trợ lý chung + N4 + khung chat nhúng |
| HD7 | Lịch thanh toán, sổ nghĩa vụ, quá hạn (`schedule.py`, `ledger/*`) |
| HD8 | Điểm đối tác, so sánh giá/biên lãi (`scoring/*`) |
| HD9 | CKS (`pages/cks/*`) |
| HD10 | Chuyển khách thật: nhập dữ liệu, ghi kép, đối soát, chuyển hẳn (N5, N6, N7) |

**Thứ tự gợi ý:** N1 + HD1 trước (cả hai luồng dựa vào); N4 eval 0.11 song song (không code); rồi HD2 ∥ N2/N3; HD3 sau N2; HD4–HD9 song song theo file không giao; HD10 cuối.

## Bảng 28 ý (R1–R28)
Có sẵn 7 (R2, R3, R9, R12, R23, R24, R25) · mở rộng nhỏ (R1, R10, R13, R14, R15, R16) · mới (R4, R5, R7, R8, R11, R17, R18, R19, R20, R22) · trước ngoài GĐ1, nay đưa vào: R6 MST, R21 áp giá phụ lục, R26 sổ thanh toán, R27 điểm đối tác/so sánh giá/CKS/trợ lý · vẫn ngoài: R28 ký số HĐ gửi đối tác (reference không có).

## Rủi ro
PD2-P04 + PD-P13/P14 chờ staging · đọc DOCX · prompt injection trong văn bản HĐ (HUB-BR-31) · số tiền tiếng Việt ("1,5 tỷ") · reference đọc cả 10.000 HĐ vào Python (`store.py:50-55`) và nhắc từng hàng (`remind.py`) ⇒ không port nguyên, viết lại theo tập · giấy phép Dify chưa xong (không chặn: gói không qua Dify).
