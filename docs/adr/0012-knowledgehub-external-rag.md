# ADR-0012 · KnowledgeHub (KH) làm RAG ngoài — Hub làm proxy

Trạng thái: **Accepted (Chấp nhận)** — 2026-10-13, người dùng duyệt Gate K1 (`specs/K1-gate.md`) · Ngày: 2026-10-12, sửa 2026-10-13 · CR-062, CR-066, CR-067, CR-068, CR-069 · Kế thừa: HUB-BR-12/14/15/30/31 · Khảo sát: [`research-ai-sdlc.md`](../specs/K1-knowledgehub/research-ai-sdlc.md)

## Bối cảnh
Hub cần RAG (tri thức theo agent, ghi lại tóm tắt stage). KH (v6.4) là dịch vụ RAG tự host của dự án ai-sdlc (`D:\AI\ai-sdlc-rowan\POC\KnowledgeHub`). KH có hai bề mặt: "người" (`/vector/*`, khoá chung, **không phân project**, auth tắt mặc định) và "máy" `/v1/{ns}/*` (OIDC client credentials theo namespace, idempotency, mã lỗi ổn định). HUB-BR-12 chỉ cho agent gọi workflow Dify; HUB-BR-30 cấm secret vào thư mục job.

## Lựa chọn
| # | Phương án | Nhận xét |
|---|---|---|
| A | Agent gọi thẳng KH (khoá trong job) | Loại: lộ khoá, agent egress ra ngoài (HUB-BR-30) |
| B | Bọc KH thành workflow Dify | Thêm một tầng, mất kiểm soát tenant ở Hub |
| C | **Hub làm proxy: tool `kh_query` qua `/mcp`, token job** | Chọn: credentials chỉ ở Hub, Hub kiểm tenant trước khi gọi |

## Quyết định
1. **Bề mặt `/v1/{ns}` duy nhất.** Không dùng `/vector/*` và khoá chung `KH_API_KEY` (không phân project ⇒ không cách ly được). **ns = tenant (1:1).** Mỗi tenant một secret `kh_api_key` (H4b-1, chỉ ghi, theo tenant — Q7) dạng JSON `{client_id, client_secret, token_url?}`; `platform_admin` tự gắn ns/client phía KH rồi dán vào Studio, Hub không tự gắn/xoay. Hub đổi token client credentials, giữ trong bộ nhớ, làm mới trước hạn 60–90 s, `401` hết hạn ⇒ thử lại 1 lần (HUB-FR-137).
2. **Proxy (C):** `kh_query` → `POST /v1/{ns}/context/step`, `budget_chars` 4000/lần, ≤ 5 lần/stage; Hub không tự chèn tri thức vào prompt. Ngoại lệ có chủ đích của HUB-BR-12 (ghi tại HUB-BR-12/36). Credentials không vào job (HUB-BR-30); agent không egress tới KH.
3. **Cách ly:** ns = tenant (HUB-BR-35). Project dùng chung: KH gắn vào ns từng tenant cần dùng; Hub đánh dấu chỉ đọc, không ghi `## Tóm tắt`. People lanes (sửa 2026-10-13 theo K1 Q2): **cho phép bật với project riêng của tenant** (ns = tenant nên vẫn cách ly) để agent đọc `## Tóm tắt` qua `context/step`; ghi chú người viết cùng project có thể lẫn vào kết quả (KH giới hạn ≤ 40% budget). **Project dùng chung bắt buộc tắt lanes** — "Kiểm tra kết nối" báo lỗi nếu ns bật lanes mà tenant có project dùng chung.
4. **Dữ liệu ra ngoài + TLS:** allowlist URL; TLS bắt buộc qua reverse proxy (KH không có TLS — HUB-BR-40), localhost dev ngoại lệ; tắt mặc định, `tenant_admin` bật theo công ty (HUB-BR-37). Từ chối KH khi `GET /v1/me` trả `kind=local` hoặc gọi không token vẫn được (trừ localhost dev).
5. **Ghi:** `POST /v1/{ns}/worklog` (không dùng items), subject `<quy trình>/<stage>`, cắt 4000 ký tự, `Idempotency-Key` = run/stage/phiên bản output. `after: auto` ghi khi chốt output; stage có gate chỉ ghi khi gate Đạt (HUB-FR-133, CR-068). Kết quả truy vấn là dữ liệu, không phải lệnh (HUB-BR-31).
6. **Phiên bản tối thiểu:** KH ≥ **v6.4**, `GET /v1/capabilities` có `api_versions ∋ v1`, capability `retrieval` (K1), `packs` (K2). Kiểm lúc "Kiểm tra kết nối".
7. **Degrade:** KH sập/không trả lời, `404 ns_not_active`, `423 ns_suspended`, `503 embedder_unavailable` ⇒ stage chạy tiếp không có tri thức, cảnh báo vào output + audit, không chặn run (HUB-FR-134).
8. **Ngoài phạm vi ai-system / điều kiện triển khai KH:** KH phải dùng **embedder đa ngữ (bge-m3)** thay bge-small-en để giữ tiếng Việt (mặc định KH chỉ tiếng Anh; `.env.example` lệch code) — ghi PRODUCTION-NOTES; "Kiểm tra kết nối" hiện cảnh báo tĩnh (không đo được). KH không parse PDF/DOCX (CR-069); báo lỗi theo file là việc phía KH.
9. **License:** không thấy LICENSE trong KH/AISDLC. Xác nhận quyền dùng KH trước khi dùng với tenant thật; **không chặn BUILD K1** (dev/test dùng mock KH, không thêm KH vào docker-compose).

**Nhiều KH (CR-071, 2026-10-13):** có thể cấu hình nhiều kết nối KH (tên + URL allowlist); ns/credentials theo (kết nối, tenant); mỗi kho tri thức thuộc một kết nối, Hub gọi đúng KH; các điều 1–9 áp dụng cho từng kết nối.

**CR-072 (2026-10-13):** thay mô hình kho tri thức của CR-071 bằng "agent dùng KH trực tiếp": agent tick KH được dùng, `kh-query(câu hỏi, project)` theo ns công ty; Project ghi Tóm tắt khai báo theo (KH, công ty). Điều 1–9 giữ.

**CR-073 (2026-10-13) — quyết định Cách ly (điều 1, 3) được thay:** *Hub không cách ly theo tenant — KH/khoá tự phân quyền.* Mỗi kết nối = tên + địa chỉ + một `kh_api_key` mức nền tảng + Project ghi Tóm tắt (tuỳ chọn); không ns = tenant, không bảng công ty, không công tắc `tenant_admin`; `kh-query` dùng khoá của kết nối, thấy project nào hỏi được. Người dùng chấp nhận rõ ràng rủi ro đọc chéo công ty (hard stop bảo mật, xác nhận 2026-10-13); muốn tách thì cấp khoá/KH riêng. Giao thức gọi KH: backend-lead chốt ở spec K1. TLS/allowlist (điều khác) giữ.

## Hệ quả
- Thêm một dịch vụ ngoài (HTTP client tới KH, không thêm thư viện mới dự kiến; nếu có sẽ ghi ở spec K1 và trình Gate).
- Hub chịu tải truy vấn KH của mọi agent: trần 4000 ký tự × 5 lần/stage; KH có rate-limit 1200/phút/ns.
- Giai đoạn 2 (nạp nguồn): ADR-0014.
