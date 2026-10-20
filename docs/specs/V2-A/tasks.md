---
id: V2-A
title: Mô hình HĐ 3 loại + mốc 7 loại (backend/API)
lane: đầy đủ (migration, tiền, RLS)
source: docs/platform/ba-v2/intake.md (V2-A, C2, C3, C8, §4) · BA v2 §2, §3.1, §5.4, §6
---
# V2-A — tasks

## Plan (đã làm)
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Test trước: luật thuần tiền/giai đoạn (`milestones.rules.test.ts`), int RLS/quyền + tiền + số câu SQL (`tests/acceptance/V2-A`) | đầy đủ | xong |
| 2 | Migration `0022_v2a_milestones.sql`: `contracts.deal/commission_pct/commission_fixed/start_date`, `obligations.title/owner/fault/qty` + 4 loại mới, `approval_settings.approval_enabled` + `approval_on()`; backfill deal + owner | đầy đủ | xong |
| 3 | API mốc: `POST /contracts/:id/milestones`, `PATCH|DELETE /milestones/:id`; settle nhận `fault` | đầy đủ | xong |
| 4 | Nhập tay: `deal` + hoa hồng; tenant tắt duyệt ⇒ `active` + mốc mặc định cùng câu | đầy đủ | xong |
| 5 | Chi tiết: `deal`, hoa hồng, `start_date`, `stage`, `next_milestone_id`, `milestones` (5.4a); danh sách: mảng `progress` | đầy đủ | xong |

## Quyết định trong lúc làm
- 7 loại BA ↔ DB: Thu tiền/Thanh toán = `kind='payment'` + `direction` receive/pay; loại khác giữ hướng theo HĐ. Giữ `/payments`, overdue, mywork không đổi. API trả loại BA.
- Giới thiệu lưu `direction='sale'` (đối tác = bên trả HH ở phía bên mua, tiền vào). Vai "bên trả HH" là việc của V2-C.
- `deal` tự theo `direction` khi HĐ chưa xác nhận (AI đọc lại); sau khi đã ở trạng thái xác nhận thì DB chặn đổi (`contracts_deal_fixed`).
- Cờ duyệt: `approval_settings.approval_enabled` (null = mặc định); mặc định TẮT cho tenant khoá `nitigroup`, `demo` (`contracts.approval_default()`, SECURITY DEFINER như 0010). Chưa có API bật/tắt — để V2-L.
- Mốc mặc định chỉ sinh khi lưu ở tenant tắt duyệt; tenant bật duyệt giữ trigger HD7 (1 đợt khi duyệt), để test HD7 không đổi.
- Mặc định: Mua = Giao (NCC) + Thanh toán (mình); Bán = Giao (mình) + Thu tiền (khách); Giới thiệu = Nhận hoa hồng. Hạn giao = bắt đầu ?? hôm nay; hạn tiền = kết thúc ?? bắt đầu ?? hôm nay.
- 5.4a: mốc tiền chính để trống chia đều **phần còn lại** (giá trị − tổng số tiền đã ghi), đồng lẻ dồn vào mốc đầu (BigInt). Mốc mặc định để trống tiền ⇒ tự theo giá trị HĐ. Bảng `/payments` cũ vẫn cộng `amount` đã ghi (sẽ thay ở V2-K).
- 5.4c: hoa hồng = cố định, hoặc giá trị × % làm tròn nửa lên tới đồng.
- Giai đoạn: Đã xong = mọi mốc bắt buộc (trừ Nhắc gia hạn, trừ huỷ) xong; Chưa bắt đầu = chưa mốc nào xong và chưa tới ngày bắt đầu (không có ngày ⇒ chưa bắt đầu); còn lại Đang thực hiện.
- Xoá mốc = `status='replaced'` (bảng chỉ thêm, REVOKE DELETE) + huỷ dòng quá hạn; sửa hạn cũng huỷ dòng quá hạn cũ.
- `fault` chỉ khi trễ (trễ không chọn ⇒ `unknown`), lưu trên mốc và `partner_events.data.fault`; huỷ dòng xác nhận ⇒ bỏ `fault`. Điểm dùng `fault` ở V2-E.
- Danh sách: `progress` là mảng riêng cạnh `items` vì ListRow 19 khoá bị test HD1 khoá. List/chi tiết vẫn MỘT câu SQL.
- Tenant tắt duyệt: sửa tiền/bên của HĐ đã lưu không mở lại duyệt (`approval_on()` đọc cùng câu khoá).

## Còn lại (lát sau)
- SL từng dòng SP cho mốc giao (`milestone_items`, 5.7a) ⇒ V2-D. Hiện mốc giao có một `qty` (null = giao hết).
- HĐ tải lên ở tenant tắt duyệt: Lưu ⇒ `active` + mốc mặc định ⇒ V2-G (hiện vẫn đi lượt duyệt cũ).
- Khoá dòng SP sau lưu (C12), sửa % hoa hồng sau lưu, API bật/tắt duyệt ⇒ V2-F/V2-L.
- Đổi thứ tự hiển thị mốc (C10) ⇒ V2-F.
