---
id: pl-editor-uatfix
lát: pl-editor-uatfix
cr: CR-105
làn: nhanh
migration: không
phụ thuộc: L3 pl-editor-ui
---
## Plan (ngắn)
Sửa lỗi UAT editor thư viện (admin-web). B1: tool hệ thống của khe (contracts-route/finalize, kể cả bước duyệt vì Hub biên dịch mỗi bước duyệt thành stage gọi route) không kiểm theo catalog tool của tenant ⇒ lưu được. B2: khoá CHỈ stage route/finalize (tool hệ thống không mang `slot.kind`); bước duyệt sửa được trên Canvas bằng form theo mã phòng ban (`SlotStageForm`, ghi `stage.slotRaw`); `stage.slot` giữ qua Canvas (`StageDraft.slotRaw`); trước khi lưu chuẩn hoá `s0 → route → s1..sn → finalize` (`normalizeSlotStages`) để thêm/xoá/đổi chỗ bước hoạt động và Hub `fromStages` dựng lại `slot_body`; seed 0069 để mã ở `*_group_id` ⇒ `repairSlot` chuyển sang `*_group_key` khi nạp; luật "bật" không đòi `after.group_id` khi slot có mã phòng ban. (a) tên bản nhân bản không chồng "(bản sao)". (b) Showcase gửi `test:true` (đúng); lượt thử ẩn khỏi danh sách lượt mặc định theo thiết kế ⇒ tab "Lượt chạy" của quy trình gửi `include_test=true`.

## Quyết định trong lúc làm
- Hub `fromStages` chỉ lấy `slot` + `name` từ stage ⇒ UI phải cập nhật `slot` khi sửa trên Canvas (không dựa `after.*`).
- Dạng song song/If trên Canvas: Hub 422 `SLOT_SHAPE_UNSUPPORTED` hiện thành toast.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: sửa lỗi UAT theo CR-105 — editor thư viện)
