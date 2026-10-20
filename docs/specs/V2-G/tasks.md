---
id: V2-G
title: AI đọc hợp đồng v2 (trích loại + trường chưa chắc + tóm tắt 5 mục + mốc; màn xác nhận dùng form V2-F; Lưu một tx)
lane: nhanh (UI + trích AI) · phần "Lưu một tx / tenant tắt duyệt ⇒ active / gắn lại SP" chạm quyền ghi + trạng thái HĐ + mốc (tiền) nên có int RLS/quyền/rollback + perf, review cuối đợt kỹ phần này; migration 0027 chỉ cộng một cột jsonb (không backfill)
ba: docs/platform/ba-v2/so-hop-tac-ba-v2.pdf §3.1 HD-02/HD-08 · §4.2 "Upload và xác nhận" · §5.5 (a/b/f) · intake V2-G
design: docs/platform/ba-v2/mockup-niti.html (chỉ đọc bố cục/màu/chữ)
---
# V2-G — tasks

## Plan (đã làm)
| # | Việc | Trạng thái |
|---|---|---|
| 1 | Contract zod: `ExtractionOutputSchema` thêm `deal`/`unsure`/`summary`/`milestones` (tuỳ chọn ⇒ bản trích cũ vẫn hợp lệ, strict từng tầng); `AiReadSchema`; chi tiết trả `ai` + `items[].product_id/component_ids`; `review.ts` (Lưu, gắn SP); mã lỗi `ITEM_LOCKED`, `REVIEW_NOT_ALLOWED` | ✔ |
| 2 | Migration `0027_v2g_ai_read.sql`: `contracts.contracts.ai_read jsonb` (null = nhập tay / chưa đọc; CHECK kiểu object ≤ 256 KiB) | ✔ |
| 3 | Lời nhắc agent (`extract-prompt.rules`): loại HĐ, trường chưa chắc, tóm tắt tiếng Việt 5 mục, mốc (7 loại) có trích dẫn; vẫn trong thẻ nonce + luật an toàn; AI chạy qua `ai-client` chung (feature `contracts.extract`, nhà cung cấp theo `AI_PROVIDER`/`AI_PROVIDER_CONTRACTS_EXTRACT` = gói Claude, ai-sub) | ✔ |
| 4 | `aiReadOf`/`verifyExtraction`/`mergeExtraction`: chưa chắc = AI báo ∪ có giá trị mà trích dẫn không có trong văn bản; mốc có cờ `verified`; trường người đã sửa bỏ khỏi chưa chắc; `saveResult` ghi `ai_read` + `deal`/`direction` (chỉ khi HĐ chưa có loại) | ✔ |
| 5 | `POST /contracts/:id/review` ("Lưu"): `planReview` thuần (loại + hướng + hoa hồng + trường + bộ mốc + `activate`) + repo 3 câu cố định (HĐ → dòng hàng + mốc → xác nhận/event) trong MỘT tx; lỗi ⇒ rollback cả tx | ✔ |
| 6 | `PUT /contracts/:id/items/:itemId/product`: gắn / gắn lại / gỡ SP cho dòng HĐ đã lưu (một CTE: kiểm dòng, khoá kho, thành phần thuộc SP) — sửa khoảng trống V2-F | ✔ |
| 7 | UI (`contracts-web`): màn xác nhận (form V2-F điền sẵn, ô chưa chắc tô vàng, loại HĐ sửa được, dòng hàng + chọn SP gợi ý sẵn, mốc AI ở cột phải), Lưu/Hủy, khối Sản phẩm gắn lại SP, khối Tóm tắt 5 mục AI | ✔ |
| 8 | Test: unit (`review.rules`, `extraction-v2`, mapper, `review-model` web), int `tests/acceptance/V2-G/{ai-read,review,attach,perf}`, e2e `v2g-review.cw.ts` | ✔ |

## Quyết định trong lúc làm
- **AI qua gói Claude**: không thêm provider — `aiTransport` đã gọi `AiClient` chung; ai-sub chọn gói/API theo `AI_PROVIDER` (mặc định `subscription` ngoài test, `off` khi test). Test int dùng seam `contractsAi.transport` (agent GIẢ tất định), không gọi AI thật.
- **Loại Mua/Bán luôn "chưa chắc"**: agent không biết bên nào là pháp nhân của mình (repo chưa có danh sách pháp nhân của mình — `direction` của HĐ tải lên luôn null trước V2-G). Lời nhắc bảo trả `sell` khi không phải Giới thiệu; server luôn thêm `deal` vào `unsure` với Mua/Bán ⇒ ô loại tô vàng để người xác nhận. Giới thiệu thì tin AI (trừ khi AI tự báo chưa chắc). Nối danh sách pháp nhân của mình để đoán Mua/Bán đúng ⇒ việc sau.
- **`deal`/`direction` AI đoán chỉ điền khi HĐ chưa có loại** (`coalesce(deal, ai)`): đọc lại không đè lựa chọn của người; `ai.deal` vẫn là ý AI. Giới thiệu ⇒ `direction='sale'` (V2-A).
- **Mốc AI tìm thấy chỉ nằm trong `ai_read` tới khi người bấm Lưu** (chưa ghi sổ). Lưu ghi bộ mốc người đã xem (nguồn `ai`), thay mốc `ai`/`default` còn mở của lần Lưu trước (bảng chỉ thêm ⇒ `replaced`). Không gửi mốc: tenant TẮT duyệt ⇒ mốc mặc định theo loại (V2-A, nguồn `default`); tenant BẬT duyệt ⇒ không đụng (HD7 sinh khi duyệt; có mốc sẵn thì trigger HD7 bỏ qua). Mốc của HĐ chưa duyệt không vào vòng quá hạn/nợ (`confirmedOf`).
- **Tenant tắt duyệt ⇒ Lưu = `active`** (V2-A để ngỏ): câu ③ tách khỏi câu ② vì trigger HD7 (đổi trạng thái ⇒ đợt mặc định) phải thấy mốc vừa ghi (CTE cùng câu không thấy nhau); lượt duyệt đang mở (`level1/level2`) đóng `done`. Tenant bật duyệt ⇒ vẫn `needs_review`, còn nút Xác nhận (HD3) — `saveFirst` của Xác nhận gọi cùng lệnh Lưu nên không mất sửa đổi.
- **Hủy không có lệnh API**: màn hình bỏ bản nháp, không gửi gì (e2e kiểm không có yêu cầu ghi); int kiểm Lưu LỖI (mốc sai loại, SP lạ, thành phần lạ, dòng lạ, hoa hồng sai loại, version lệch) không ghi gì (snapshot HĐ/dòng/mốc/event y nguyên).
- **Dòng hàng**: Lưu sửa theo `id` (dòng AI đọc) và thêm dòng mới (`ord` nối tiếp); KHÔNG xoá dòng (D-08: REVOKE DELETE). Dòng sửa ⇒ `edited`; dòng giữ nguyên vẫn của AI. `id` không thuộc HĐ / thành phần không thuộc SP ⇒ rollback + 422.
- **Gắn lại SP (C12)**: chặn `409 ITEM_LOCKED` khi HĐ đã có phát sinh kho (`stock_moves.contract_id`, V2-D ghi) hoặc đang `extracting` (AI sắp thay dòng); còn lại sửa được ở mọi trạng thái (SP không đổi tiền/nhánh duyệt). Sự kiện `item_product_set`.
- **Gợi ý SP**: tái dùng `POST /products/match` của V2-B (quy tắc nhận diện trước, rồi trùng từ, rồi "Tạo sản phẩm mới" + gợi ý thành phần); màn xác nhận gọi song song cho dòng chưa gắn (≤ 50) — chưa có endpoint lô (nợ nhỏ, số dòng HĐ thường ≤ 10).
- **Chưa chắc (tô vàng)** = `ai.unsure` ∪ trường có giá trị mà `verified=false`, ẩn khi người đã sửa ô đó (`edited`). Tóm tắt là văn bản tự do của AI (không có trích dẫn để kiểm) ⇒ khối hiện dưới nhãn "AI tóm tắt", không bịa thêm câu ngoài 5 mục.
- **Hoa hồng**: Lưu gửi/giữ; gửi một bên thì bên kia bỏ (CHECK DB); đổi sang loại khác Giới thiệu ⇒ hoa hồng bỏ. Sửa % hoa hồng sau khi HĐ đã active vẫn chưa có (V2-L).
- Số migration 0027 / `when` 1795400000000 (sau 0024; 0025 = V2-E, 0026 = V2-D): đối chiếu khi merge.

## Kiểm
- Unit hub-api contracts + packages/contracts: 695 pass (local); contracts-web `bun test src` 192 pass; typecheck hub-api + contracts-web + `tsc -p tsconfig.tests.json` (còn 1 lỗi cũ của V2-F `manual-items.int.test.ts:72`, có sẵn ở `platform/gd0`); `i18n:check` xanh.
- int + e2e trên evotest: xem "Kết quả evotest" bên dưới.

## Kết quả evotest
- int evotest (2026-10-20): V2-G + V2-F + V2-A + HD1 + HD2 + HD3 = 262 pass, 0 fail.
- Perf Lưu: 6 câu SQL (gồm set_config) cho 3 dòng x 2 mốc và 200 dòng x 50 mốc, cả bật/tắt duyệt; 200x50 p50 32,4 ms, p95 52,6 ms (12 lần, evotest).
- e2e: chưa chạy (coordinator chạy cuối đợt); spec 2g-review.cw.ts đã viết, chạy local win32 xanh (17 test), baseline win32 đã chụp; linux + relock 	ests/.lock sau.

## Việc còn lại (lát sau)
- Danh sách pháp nhân của mình để AI/server đoán Mua/Bán đúng (hiện luôn "chưa chắc").
- Endpoint gợi ý SP theo lô (hiện N lời gọi `products/match` song song ở client).
- Sửa % hoa hồng sau khi HĐ đã active (V2-L); điểm ± từng mốc (V2-E); thông báo "kho X: a → b" (V2-D).
- Bước "Xác nhận" (HD3) cho tenant bật duyệt vẫn là thẻ duyệt cũ; gộp vào Lưu là việc của V2-L (API bật/tắt duyệt).
- Linux baseline + relock `tests/.lock` (lý do «CR-096 V2-G») làm sau khi gộp nhánh (xem báo cáo).
