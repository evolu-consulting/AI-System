---
id: cr125-c3-terms-paths
lát: cr125-c3-terms-paths
cr: CR-125
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Sửa các dòng chữ/tên của `docs/specs/CR-125/consistency-audit.md` (#3 #9 #15 #17-19 #21 #22 #25 #28-31 #8 #14) và thêm check chữ.

## Làm
- Đường dẫn "Cài đặt › <mục>" sinh từ MỘT nguồn: `packages/i18n/src/settings-paths.ts` (nhãn `contracts.settings.sec.*`); chuỗi chỉ ghi token `{{path:flow}}`, loader contracts + process mở rộng lúc nạp. Sửa "Cài đặt › Ký số" / "Cài đặt › Quy trình" → `{{path:flow}}` (Quy trình duyệt).
- Thuật ngữ vi: quy trình (không flow/khe), tính năng thêm (không add-on), bản ký (không phong bì), chữ ký số (không CKS), duyệt (không kiểm), Nháp, Đã ký, Mở lại quy trình, Người ký phía công ty. Gỡ khối `tenants.slots.routing` (CR-121, không còn dùng).
- Một module TS tên/mã HĐ: `packs/contracts/domain/contract-name.ts` (`contractNameOf`, `contractCodeOf`, `contractCodeLabel`); `contractLabelOf` (mã trước) đổi thành `contractCodeOf`.
- Check mới: `check:i18n-terms` (+ `packages/i18n/glossary.vi.json`), `check:settings-path`, `check:i18n-unused` (báo cáo), `check:contract-name` thêm chế độ TS. `check` + cổng sau rebase của slice:merge chạy terms + settings-path.

## Không làm / Chạm
Không đụng trạng thái ký số (c1), ô ngày (c4). Web `ContractReviewPage` vẫn đọc `fields.title` (allowlist, chờ hub trả `name`). Chưa dọn 175 khoá thừa (báo cáo của i18n-unused). Bản en: chỉ sửa token đường dẫn + dấu `›`.

## Test tối thiểu
Unit: settings-paths, 3 check mới, contract-name (TS + SQL), slice-rebase gates. e2e hành trình chạy một lần cuối (nhãn đổi).

## Quyết định trong lúc làm
- Một đường dẫn ký số = "Cài đặt › Quy trình duyệt" (mục `flow`); nơi gán quy trình vẫn là Admin "Công ty › Quy trình" (hai app khác nhau, đều là mục có thật).
- Nút mở lại chung tên "Mở lại quy trình"; nút huỷ+mở lại = "Huỷ và mở lại quy trình".

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr125-docs-sync)

Không thay đổi hành vi (lý do: chỉ đổi chữ hiển thị, gom helper tên/mã HĐ giữ nguyên thứ tự hiện có, thêm check tĩnh)

## Việc còn lại
P-a pf4: process-library sửa tên tab (Mẫu có sẵn). 3 spec (admin-editor, editor-steps, library-readonly-copy) đỏ cả trên gd0 do BUG SẢN PHẨM: admin-web /processes/<id> crash `reading 'map'` ⇒ ghi known-red, cần lát sửa editor. run-unread.pa.ts chập chờn.
