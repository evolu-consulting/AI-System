---
id: cr121-r4-feature-save-race
lát: cr121-r4-feature-save-race
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Lỗi sản phẩm (không chỉ test): editor Feature mất nháp / hiện hàng trùng khi lưu lần 1 → sửa tiếp → lưu lần 2 mà phản hồi hoặc refetch của lần 1 về muộn. Nguyên nhân: (1) `useUpdateFeature.onSuccess` trả Promise refetch nên `mutateAsync` (và `onSaved` → `form.reset`) chờ refetch; (2) `command_ids` không phải field đăng ký nên `keepDirtyValues` không giữ nháp, reset đè; (3) refetch cũ về muộn thay `feature` mới hơn trong cache; (4) `onPick` không chống trùng id.

## Làm
- `lib/save-merge.ts` (luật thuần + test): `commandsAfterSave`, `isStaleSave`, `newerDetail`, `uniqueIds`.
- `api.ts`: `onSuccess` ghi phản hồi PATCH vào cache (không lùi version) rồi invalidate KHÔNG chờ; `useFeature` giữ bản mới hơn khi refetch cũ về muộn.
- `use-feature-conflict.ts`: `onSaved` bỏ phản hồi cũ hơn version đã áp; reset theo phản hồi, nếu người dùng đã sửa tiếp thì đặt lại nháp `command_ids` + dirty.
- `FeatureCommandsTab.tsx`: thêm command chống trùng id.
- Gỡ `networkidle` R-3 khỏi e2e/features.spec.ts (không còn cần).

## Không làm / Chạm
Chỉ `apps/admin-web/src/features/features/**` và e2e/features.spec.ts. Perf: không chạm đường nóng (bỏ chờ refetch ⇒ lưu xong nhanh hơn).

## Test tối thiểu
unit `save-merge.test.ts` (local, 7 ca); e2e `-Filter root` một lượt (CR-055 M2-AC04 không còn networkidle).

## Quyết định trong lúc làm
Không dựng test component (admin-web chưa có testing-library): tái hiện bằng luật thuần + e2e có sẵn.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED admin/catalog-quota-audit.md
#### Yêu cầu: Editor Feature giữ nháp khi lưu liên tiếp
Sau khi lưu, form dựng lại theo ĐÚNG phản hồi của lần lưu (không chờ tải lại danh sách). Người dùng sửa tiếp trong lúc chờ thì nháp command được giữ (và vẫn tính là chưa lưu); phản hồi/tải lại cũ hơn bản đã áp bị bỏ qua; một command không bao giờ xuất hiện hai lần trong danh sách.
- Kịch bản: khi phản hồi lưu lần 1 về muộn sau khi người dùng đã bỏ một command thì nháp được giữ và vẫn chưa lưu [test: apps/admin-web/src/features/features/lib/save-merge.test.ts » phản hồi lưu lần 1 về muộn sau khi người dùng bỏ /kiemtra-hoadon: giữ nháp [tom-tat], vẫn dirty]
- Kịch bản: khi thêm command đã có thì danh sách không có hàng trùng [test: apps/admin-web/src/features/features/lib/save-merge.test.ts » không bao giờ có id lặp (nhân đôi hàng /tom-tat)]
- Kịch bản: khi tải lại cũ về sau bản mới hơn thì giữ bản mới hơn [test: apps/admin-web/src/features/features/lib/save-merge.test.ts » refetch cũ (v2) về sau khi đã có v3 trong cache ⇒ giữ v3]
- Kịch bản: khi lưu, bỏ command chỉ thuộc feature này rồi thêm lại thì lưu được liên tiếp [test: thủ công — e2e/features.spec.ts ca CR-055 M2-AC04 chạy ở verify:wave (tiêu đề ca chứa dấu chấm phẩy nên không trích được)]

## Việc còn lại
