# Sổ Hợp Tác · Mốc, kho, công nợ

Cập nhật: 2026-10-27 · Gộp từ: V2-A/V2-B/HD7 (nền), delivery-opts (CR-100), MS-impact (CR-101b), DOC-deals mục 5, K1.

## 1. Mốc (obligation)
- Mốc = hàng `contracts.obligations`. 7 loại: `delivery` Giao hàng · `collect` Thu tiền · `pay` Thanh toán · `commission` Nhận hoa hồng · `serial` Cấp serial/kích hoạt · `renewal` Nhắc gia hạn · `other` Khác. Thu/Thanh toán lưu `payment` với hướng tiền; Giới thiệu = tiền vào. Tiền = số nguyên đồng (BigInt, ≤ 10¹⁵); ngày `YYYY-MM-DD`.
- Mốc mặc định theo loại HĐ/giao dịch (mua: giao + trả; bán: giao + thu; giới thiệu: nhận hoa hồng). HĐ NT không có mốc mặc định (chỉ `renewal`/`other`).
- API: `POST /contracts/:id/milestones`, `PATCH|DELETE /milestones/:id`, `PUT /contracts/:id/schedule`, `POST /obligations/:id/{settle,postpone,remind}`, `GET /obligations`, `GET /payments`. HĐ đã khoá: thêm/sửa/xoá mốc ⇒ 409; xác nhận xong/hoãn/nhắc vẫn được; **giao dịch không khoá** nên sửa mốc tự do.
- Mốc có lỗi bên: `fault` ∈ `partner` | `ours` | `unknown`. Chỉ lỗi đối tác trừ điểm (đã có).
- Code: `H/domain/milestones.rules.ts`, `H/domain/ledger.rules.ts`, `H/adapters/{milestones,ledger-*}.repo.ts`, `W/features/contract-milestones/**`, `W/features/ledger/**`.

## 2. Kho khi xác nhận mốc giao
- Kho chạy **khi xác nhận mốc giao** (không khi tạo HĐ). Kho + bình quân gia quyền (BQ) riêng từng thành phần; nhập theo lô; xuất theo BQ; gói suất có hạn (quá hạn ⇒ dòng `expire` trước). Số học SL ×10⁴, tiền đồng. Xuất hết tồn lấy đúng giá trị còn.
- Một luật cho HĐ và Giao dịch (`H/domain/delivery.rules.ts`, `stock.rules.ts`, `H/adapters/stock.repo.ts`, `delivery.repo.ts`).
- Xoá chứng từ đảo kho theo `contract_id`; thiếu tồn để đảo ⇒ chặn (`stock_blocked`). Sau giao vượt tồn thì đảo kho chưa kiểm tay (xem "Chưa rõ").

## 3. Đợt giao theo % (CR-100)
- `obligations.delivery_pct numeric(5,2)` (migration 0053). Xác nhận mốc giao không có bảng SL ⇒ SL dòng = làm tròn(% × SL HĐ) (SL nguyên làm tròn đơn vị, lẻ giữ 4 số lẻ), tối đa phần còn lại; **đợt cuối** (Σ % đã xác nhận + % này ≥ 100) lấy phần còn lại.
- Ưu tiên: bảng SL người dùng sửa > % > SL chung cũ > phần còn lại. % và SL chung không đi cùng ⇒ 422. Không chặn tổng % ≤ 100 lúc lưu mốc; đợt vượt bị chặn bởi phần còn lại. Luật thuần `splitByPct`.
- `GET /milestones/:id/delivery` (bảng "Giao đợt này" tính sẵn, sửa được: PATCH items rồi settle); `POST /stock/check` (cảnh báo thiếu kho).

## 4. Giao vượt tồn (CR-100)
- Mặc định **tắt**: giao vượt tồn ⇒ lỗi `STOCK_INSUFFICIENT`. Công tắc `approval_settings.allow_negative_stock`, đặt ở Cài đặt › Công ty (mục "Kho & giao hàng") qua `PUT /company`, có nhật ký `approval_settings_audit`.
- Bật: `applyDelivery` lập kế hoạch như cũ; chỉ khi `stock_insufficient` mới đọc cài đặt (cùng tx, sau khoá thành phần) rồi lập lại với `allowNegative`. Xuất lấy phần tồn dương theo lô/BQ, phần vượt = tồn âm, giá vốn theo BQ, giá trị tồn giữ ≥ 0 (= 0 khi tồn ≤ 0); nhập khi tồn âm bù phần thiếu trước. Sổ ghi `stock_moves.overdrawn`, ghi chú "giao vượt tồn N", toast sau khi giao.
- DB: 0053 nới `product_components_qty_ck` và `stock_moves_num_ck` (bỏ `on_hand >= 0`), giữ giá trị ≥ 0.
- Code: `H/domain/delivery.rules.ts` (`checkPlan`, `overdrawNotes`), `W/features/contract-milestones/components/DeliveryLines.tsx`. Nguồn: `docs/specs/delivery-opts/tasks.md`.

## 5. Xác nhận mốc + xem trước tác động (CR-101b, MS-impact)
- Hộp xác nhận mốc (`ConfirmBox.tsx`) hiện tiêu chí và điểm **trước → sau** do **máy chủ** tính, không ghi: `GET /obligations/:id/impact?fault=partner|ours|unknown&actual_on=YYYY-MM-DD` (quyền `read`; HĐ không thấy/tenant khác ⇒ 404; mốc đã xong ⇒ 409 `OBLIGATION_DONE`; fault/ngày sai ⇒ 400).
- Phản hồi: `{obligation_id, at, late, fault, reputation:{engine, role, party, before{score,level}, after, counted, pending_fault}|null, stock:[{component_id,name,before,after}], debt:{direction,before,after}|null}`. Không có công thức riêng: dựng phần settle sẽ ghi rồi để engine điểm hiện hành chấm lại (V2-E hoặc HD8 theo cờ `REPUTATION_ENGINE`). Đã bỏ ước lượng ở client (`lib/points.ts`).
- Số câu SQL cố định (5 mỗi engine + 2 câu kho khi mốc giao). Đo thật (nền 1.000 đối tác × 3 vai): V2-E p95 19,1 ms; HD8 p95 83,1 ms (ngưỡng 100).
- **Lưu delta thật khi xác nhận**: `partner_events.data.impact = {engine, role, before, after}`, cùng câu ghi `settle`, **chỉ khi cờ `v2e`** (HD8 không lưu để giữ ngưỡng V2-D `confirm.perf` p95 ≤ 50 ms). Dòng thời gian mốc đọc `Milestone.rep_delta` ("uy tín X: a → b") từ `data->'impact'`.
- Lỗi mốc "Chưa rõ" (`unknown`): engine **không** trừ điểm (V2-E coi = 100); xem trước có `pending_fault: true`; sau **3 ngày** (≤ 90 ngày) xuất hiện việc "Xác minh lỗi mốc trễ" (`phap-ly-va-can-xu-ly.md`). Đổi lỗi mốc đã xác nhận = huỷ dòng sổ rồi xác nhận lại.
- Index `obligations_party_done_idx (tenant_id, party_key, done_at) WHERE status='done'` (0059).
- Code: `H/application/obligation-impact*`, `H/domain/obligation-impact.rules.ts`, `H/adapters/obligation-impact.*`, `W/features/contract-milestones/**`. Chuỗi: `locales/contracts/msimpact.*.json`.

## 6. Ô "đã giao / đã thanh toán ngay"
Giao dịch lưu với `settled_now` tự xác nhận mốc giao rồi mốc tiền khi lưu (kho chạy, vượt tồn theo công tắc §4). Xem `chung-tu.md` §3.

## Chưa rõ
1. Đảo kho (xoá chứng từ/huỷ) cho dòng đã giao vượt tồn: đảo xuất trả lô mới theo giá trị đã xuất; chưa kiểm tay (delivery-opts "kiểm khi UAT").
2. Migration 0053 trên DB có dữ liệu thật: chưa kiểm.
3. HD8 vẫn đọc sổ/HĐ/giá cả tenant theo vai khi xem trước tác động (không lọc đối tác): nợ hiệu năng đã ghi, chưa xử lý.
4. Baseline ảnh `v2f-detail-confirm-box` chưa chụp lại sau khi thêm dòng tác động (chờ e2e cuối đợt).
