---
id: V2-M
title: Xoá hợp đồng hẳn (HD-07, 5.5e, 6a, C7)
lane: đầy đủ (mất dữ liệu, tiền/kho, RLS)
ba: docs/platform/ba-v2/so-hop-tac-ba-v2.pdf · intake C7 (CR-096b)
---

## Plan ngắn
- API (`PackGuard admin` = vai `contracts-owner`): `GET /contracts/:id/delete-preview` (tác động), `DELETE /contracts/:id`.
- Một tx: `reverseContractStock` (TS, `planReversal` thuần) ghi dòng sổ `reversal` + trả/trừ lô + tồn/BQ → `contracts.delete_contract(id, tenant)`
  (migration 0035, SECURITY INVOKER): voids `partner_events` của HĐ, gỡ `service_customers` (HĐ trước trong chuỗi gia hạn đồng bộ lại),
  xoá `milestone_items`/`obligations`/`approvals`/`followups`/`sourcing_choices`, xoá HĐ (FK cascade dòng, nhắc hạn, nhật ký HĐ), xoá SP
  `created_from_contract_id` không còn dùng nơi khác (5.5e), một dòng `contract_delete_log`.
- RLS vẫn FORCE: `contracts_rw` lấy lại DELETE nhưng policy RESTRICTIVE chỉ mở khi tx có cờ `contracts.v2m_del = <id>` (hàm đặt/xoá cờ).
  Hàm từ chối nếu còn dòng `delivery` chưa đảo kho.
- UI: nút "Xoá hợp đồng" (owner) ở chi tiết HĐ ⇒ hộp xác nhận liệt kê tác động ⇒ "Xoá hẳn".

## Quyết định trong lúc làm
- Xuất (HĐ bán) đảo thành LÔ MỚI (sổ xuất không ghi lô nguồn); nhập đảo trừ đúng lô, phần lô đã xuất trong chính HĐ thì rút khỏi lô mới trả.
- Hàng nhập từ HĐ đã bán sang HĐ khác ⇒ 409 `DELETE_STOCK_BLOCKED`, không xoá gì. Còn phụ lục ⇒ 409 `CONTRACT_HAS_APPENDIX`;
  gắn lô/chứng thư CKS ⇒ 409 `CONTRACT_HAS_CKS`.
- `score_locks` không đụng; điểm hiện tại đổi nhờ voids + mất mốc. Migration số 0035, `when` 1796200000000 (idx 30 ở nhánh này — đánh lại khi merge).

## Việc còn lại / lưu ý
- Việc hẹn (`followups`) của NGƯỜI KHÁC gắn HĐ không xoá được dưới RLS của người xoá (chỉ thấy việc của mình) — còn lại mồ côi.
- File gốc trong FileBox không bị xoá (chỉ bản ghi).
- e2e `e2e/contracts-web/v2m-delete.cw.ts` đã viết, chưa chạy (Luật 0b).
