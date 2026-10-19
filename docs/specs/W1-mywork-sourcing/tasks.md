# W1 — "Việc của tôi" + "Mua hàng" (contracts-web, gói `contracts`)

Làn: **đầy đủ cho phần RLS/quyền/thấy M1 (bảng `sourcing_choices`, `followups`, đọc theo luật thấy), nhanh cho phần màn hình** (Luật 0b, một agent làm trọn). Nhánh `slice/w1-mywork` (đã rebase lên `platform/gd0` sau M1b).

## Nguồn (mgmt-app, chỉ đọc)
- Việc của tôi: `api/app/assistant/digest.py` (thẻ đầu trợ lý: hẹn nhắc, tiền tới hạn/trễ, HĐ mua sắp hết hạn) + `routes/{board,followups,obligations}.py`, `ledger/followups.py`. **mgmt-app không có màn riêng** (web/ và cm-web/ chỉ hiện việc ở khoang trợ lý) ⇒ màn thiết kế mới theo khung contracts-web (3 ô số, chip lọc, danh sách nhóm Trễ hạn / Hôm nay / Sắp tới). Không có cảnh so ảnh.
- Mua hàng: `api/app/routes/sourcing.py`, `contracts/sourcing.py`, `contracts/products.py::lines`, `cm-web/app/sourcing/*` (Next, không phải web Vite dùng cho so ảnh ⇒ không so ảnh).

## Đã làm
| Phần | Nội dung |
|---|---|
| API | `GET /pack/contracts/my-work`; `GET/POST /pack/contracts/followups`; `POST /followups/:id/{done,snooze}` (= `/my-work/followups/:id/*`); `GET /pack/contracts/sourcing?contract=&q=&risk=&page=&page_size=`; `PUT /pack/contracts/sourcing/:contractId/:line` |
| Migration | `0013_w1_mywork_sourcing` (số kế tiếp sau `0012_i1_legacy` trên `platform/gd0`; `when` > mục cuối; HD78 lấy số kế tiếp): `sourcing_choices` (RLS tenant + RESTRICTIVE theo thấy HĐ bán), `followups` (RLS tenant + RESTRICTIVE: của riêng người tạo VÀ HĐ gắn phải thấy), 3 index (`contracts_deadline_idx`, `cks_followups_user_idx`, `contract_reminders_user_idx`) |
| Web | `/my-work`, `/sourcing` (phân trang + tìm + lọc rủi ro ở máy chủ), thẻ «Nguồn hàng & lãi» trên trang chi tiết HĐ, nút «Hẹn nhắc» trên đợt / hạn HĐ; mục menu «Việc của tôi», «Mua hàng» (`data-w1-nav`, ẩn ở cảnh so ảnh shell) |
| Test | unit: `domain/{mywork,sourcing}.rules.test.ts`, `features/{mywork,sourcing}/lib/*.test.ts`, `shell-lib.test.ts`; int: `tests/acceptance/W1/{mywork,sourcing}.int.test.ts` (gồm đối chiếu bản SQL với bản tham chiếu TS trên cùng dữ liệu) + RLS suite (`rls-packs.int.test.ts`); perf: `tests/acceptance/W1/perf`; e2e: `e2e/contracts-web/{mywork,sourcing}.cw.ts` |

## Quyết định trong lúc làm
- "Việc của tôi" = (a) đợt thanh toán mở (HD7) tới hạn ≤ 7 ngày kể cả trễ, (b) hạn xử lý HĐ (HD4 `action_deadline`) ≤ 7 ngày, chưa ghi kết quả, không quá 60 ngày sau hết hạn, (c) nhắc hạn HD4 đã gửi cho mình (hạn > 7 ngày, mốc mới nhất mỗi HĐ), (d) hẹn nhắc CKS (HD9) CỦA MÌNH ≤ 7 ngày, (e) hẹn nhắc chung (W1) của mình ≤ 7 ngày (về đợt đã xong thì ẩn). Mọi nguồn qua RLS gói ⇒ chỉ cái người dùng thấy (M1/M1b): hẹn nhắc gia hạn của HĐ không thấy và hẹn nhắc về khách CKS không thấy bị loại. Một câu SQL cho cả danh sách (mỗi nguồn ≤ 101 hàng, tổng ≤ 200, báo `truncated`).
- Hành động: dùng lại route HD7 (`settle`, `postpone`) và HD4 (`handled`); `done`/`snooze` cho hẹn nhắc của mình (quyền `read`: hẹn nhắc là của riêng người dùng, như mgmt-app); ghi sổ/HĐ cần `write`.
- Hẹn nhắc chung (`subject_kind` = obligation | contract | company | renewal): tiêu đề do máy chủ đặt như mgmt `subject()`; chủ thể phải có và người dùng thấy (đối tác qua `visible_party_keys()`), không thấy ≡ 404; một hẹn nhắc mở mỗi (người, chủ thể), đặt lại ⇒ dời. Gửi đúng giờ: xong ở W1b (`docs/specs/W1B-followup-send/tasks.md`). Settle một đợt không tự đóng hẹn nhắc (màn ẩn hẹn nhắc về đợt không còn mở).
- Mua hàng: dòng giá = HĐ đã duyệt + phụ lục (giá phụ lục thay giá gốc theo `applyAppendixPricing` HD5); `current` theo NGÀY hiệu lực + HĐ còn sống (không dùng cờ "đã bị thay" của đồ thị). Nguồn người chọn lưu ở `sourcing_choices` (mgmt lưu trong bản ghi HĐ; không FK sang HĐ — D9-02); chọn không còn là ứng viên ⇒ về tự chọn. `line` = `ord` của dòng hàng. Đơn vị rỗng (sau cắt) khớp mọi đơn vị.
- **Mua hàng — phân trang ở máy chủ + bộ nhớ đệm theo tenant** (`application/sourcing.usecase.ts`, `sourcing-cache.ts`): đã thử tính cả báo cáo trong MỘT câu SQL tập hợp (CTE + cửa sổ, 100 HĐ ≈ 20 ms nhưng 2.000 HĐ ≈ 550 ms vì CTE vật hoá không có thống kê) nên bỏ. Cách chốt: dòng giá của CẢ tenant (phần đắt, không phụ thuộc người xem) nạp một lần ở tx hệ thống và nhớ trong tiến trình (LRU 16 tenant) theo **dấu vân tay** (số HĐ đã duyệt + `updated_at` lớn nhất + tổng `version` + băm id/trạng thái/hướng + số/ngày lựa chọn nguồn) và ngày lịch. Mỗi request: dấu vân tay ‖ tập id HĐ người dùng thấy (RLS M1/M1b) ⇒ lọc dòng ⇒ nguồn / lãi / rủi ro / tìm / trang trong bộ nhớ; chỉ MỘT trang (≤ 100 dòng) + số liệu tổng + nhà cung cấp + ứng viên của sản phẩm trong trang đi ra trình duyệt. Trúng = 4 câu SQL, trượt = 7 (cố định). Giới hạn đã biết: dấu vân tay không thấy sửa dòng hàng mà không đụng HĐ (mọi đường ghi hiện có đều tăng `version`); phụ lục ẩn với người xem vẫn ảnh hưởng `valid_to` của dòng gốc họ thấy (không lộ nội dung).
- `domain/sourcing.rules.ts` là nguồn logic (khoá sản phẩm, thay giá phụ lục, nguồn, lãi, rủi ro, nhà cung cấp); sắp xếp theo `localeCompare`.
## Số đo (evotest, Luật 4c)
- `GET /my-work` (10.000 HĐ / 20.000 đợt / 5.000 hẹn nhắc + nền): p50 ≈ 15 ms, **p95 ≈ 24–31 ms**, 2 câu SQL, không Seq Scan.
- `GET /sourcing` (bộ nhớ đệm trúng, qua HTTP thật): 100 HĐ p95 **9,8 ms**; 500 HĐ p95 **10,7 ms**; **2.000 HĐ p95 21,5 ms** (trước: 2.000 HĐ p95 244 ms, tải 3 MB; 500 HĐ p95 220 → 116 ms ở bản trước). Lần trượt (nạp lại sau khi dữ liệu đổi) ≈ 200–250 ms ở 2.000 HĐ, một lần mỗi lần đổi dữ liệu.

## Còn lại
- Nút "Hẹn nhắc" trên màn khác (HĐ/đối tác) — API sẵn sàng.
- Review + security cuối đợt (Luật 0b); STATE/ROADMAP cập nhật một lần cuối đợt.
- Ca RLS `partner_event_voids` "thăm dò tồn tại" (22P02 vs 42501) **đỏ sẵn trên `platform/gd0`** (đã chạy lại ở `-Ref platform/gd0`): của HD7, giao HD78 — không do W1.