---
id: cr122-p4-first-launch
lát: cr122-p4-first-launch
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: E1b, A2
---
## Plan (ngắn)
Sửa lỗi sản phẩm qc tìm ở Q1: #4 HĐ đầu tiên sau khi gán flow không mở lượt (catalog tính năng cũ trong ConfigCache ⇒ từ chối không thử lại), #5 Community không "Chờ duyệt" khi flow `post.created` đã gán (moderationOn chỉ đọc luật khe).

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Gán flow có hiệu lực ngay
Sau khi gán và bật, sự kiện đầu tiên mở lượt ngay; thiếu tính năng thì làm mới catalog một lần rồi kiểm lại trước khi từ chối. Community coi bài cần duyệt khi cờ bật và có flow `post.created` đang bật.
- Kịch bản: gán + bật ⇒ sự kiện đầu tiên mở đúng 1 lượt [test: apps/hub-api/src/modules/processes/triggers/first-launch.int.test.ts]
- Kịch bản: flow duyệt bài đã gán ⇒ bài đối tác "Chờ duyệt" [test: apps/hub-api/src/modules/packs/community-flow.mount.int.test.ts]
