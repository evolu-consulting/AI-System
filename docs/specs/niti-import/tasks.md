---
id: niti-import
title: Nhập dữ liệu thật của chị Tiên (sohoptac cũ) vào tenant nitigroup
cr: CR-095
lane: đầy đủ (chuyển dữ liệu khách thật) — test int viết cùng lát, chỉ chạy trên evotest với dữ liệu giả
depends: I1 (importer), niti-onboard, niti-attach/niti-filebox, tenant-owner (user `tien`)
---
# niti-import (plan ngắn)

Người dùng (2026-10-21) đảo D-NITI-09: dữ liệu sohoptac cũ của tài khoản chị Lê Thị Thuý Tiên là THẬT (11 HĐ + sổ HĐ) ⇒ nhập vào
`nitigroup` trên sohoptac2. Chỉ tài khoản đó; không thư/thông báo nào; nguồn chỉ đọc.

- Mở rộng `mgmt-import` (không viết lại): `--owner-email` (email cũ) + `--owner-username` (user đích, tra theo username, vắng ⇒
  `OWNER_USER_NOT_FOUND`) + `--from-export` + `--rollback`. Export chỉ-đọc mới: `mgmt-export.cli.ts` (liệt kê chủ HĐ / file đã lọc).
- Lọc `domain/owner-scope.rules.ts`; kế hoạch `domain/owner-plan.rules.ts` (mapper I1 có sẵn: HĐ, phụ lục, hạng mục, nhắc đã gửi,
  đợt, sổ, đánh giá); use case `application/owner-import.usecase.ts` + `owner-rollback.usecase.ts`; SQL `adapters/owner.repo.ts`.
- Runbook: `deploy/prod-sohoptac2/README.md` "Nhập dữ liệu chị Tiên".

## Việc
| # | Việc | Làn | Trạng thái |
|---|---|---|---|
| 1 | Lọc theo chủ + export chỉ-đọc + đọc file export | đầy đủ | xong |
| 2 | Nhập một tx mỗi HĐ, chủ = `tien`, chặn nhắc hạn cũ, file → FileBox + sha256, báo cáo đối soát | đầy đủ | xong |
| 3 | Hoàn tác theo nhãn lô | đầy đủ | xong |
| 4 | Unit `owner.rules.test.ts` + int `tests/acceptance/NITI/owner-import.int.test.ts` (evotest 5/5) | đầy đủ | xong |
| 5 | Chạy trên máy chủ (người dùng) | — | chờ |

## Quyết định trong lúc làm
- D-NI-01: "Của chị Tiên" = HĐ có `owner_email` = email cũ, hoặc chưa giao mà `created_by` = email cũ; phụ lục của các HĐ đó đi theo
  (kể cả phụ lục người khác phụ trách); đợt/sổ theo HĐ; sự kiện sổ không gắn HĐ (đánh giá) chỉ khi `by` = email cũ.
- D-NI-02: Mọi HĐ nhập: `owner_user_id = created_by = tien`; người khác trong dữ liệu cũ (người xác nhận, người ghi sổ) ⇒ null.
- D-NI-03: Không ghi danh tính (N5), loại hàng, danh bạ `contracts.companies`, CKS, tri thức, hẹn nhắc: `contracts_rw` không có
  DELETE ở các bảng đó ⇒ hoàn tác không sạch được; đối tác vẫn hiện qua `party_key` từ trường HĐ/sổ. Báo cáo liệt kê `partners`,
  `unmapped_fields`, `not_imported` để người dùng thấy phần không chuyển.
- D-NI-04: Chặn thông báo: mốc nhắc HD4 (60/30/7/1/0 ngày trước `action_deadline`) đã qua tính tới hôm nay (múi VN) ⇒ hàng
  `contract_reminders` kênh `mgmt_import` trong cùng tx với HĐ (chỉ HĐ vừa chèn). Vòng nhắc ON CONFLICT ⇒ không `notify.enqueue`.
  Mốc tương lai nhắc bình thường. Không có đường thông báo nào khác đọc bảng nhập (grep `notify.enqueue`: chỉ nhắc hạn + hẹn nhắc).
- D-NI-05: Nhãn lô = `--source`, ghi ở `data.mgmt_source` của sự kiện `mgmt_import` (thêm vào mapper I1) và của sự kiện sổ. Hoàn tác =
  `contracts.delete_contract` (đường xoá app) + huỷ sự kiện sổ (chỉ thêm); file (hàng + object) GIỮ vì app không có DELETE trên
  `contracts.files`; nhập lại sau hoàn tác dùng nhãn mới.
- D-NI-06: Export lọc ngay lúc export (file chỉ có dữ liệu của chị); importer lọc lại lần nữa. File đọc cả vào bộ nhớ, từng file một
  (quy mô 11 HĐ); sha256 nguồn ↔ đọc lại từ FileBox.
- D-NI-07: HĐ của chủ trải > 1 org ⇒ dry-run báo `OWNER_SPANS_ORGS`, apply từ chối (thư mục file theo org).

## Kết quả
- evotest int: `NITI/owner-import` 5/5 (4,1 s); lượt đầu cùng `NITI` + `I1`: 23/24 (đỏ duy nhất = xoá `contracts.files` thiếu quyền ⇒
  D-NI-05), I1/NITI cũ xanh với nhãn `mgmt_source` mới.

## Còn lại
- qc ghi lock cho test mới; chạy runbook trên máy chủ (người dùng).
