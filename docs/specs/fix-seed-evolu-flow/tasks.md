---
id: fix-seed-evolu-flow
lát: fix-seed-evolu-flow
cr: CR-150
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
`seed-demo-partner --partner-only` lỗi `PUT /process-defs/<id> → 422 PROCESS_DEF_INVALID` khi lưu quy trình Nhận HĐ của evolu.

## Làm
- Nguyên nhân: sơ đồ trống không có `inputs`, nhưng bước Ký số lấy `contract_id` từ đầu vào ⇒ TOOL_INVALID ở `args.contract_id` (hợp lệ khi seed gửi `inputs: FLOW_TEMPLATE_INPUTS`: `seedInputs`). Không phải nhà cung cấp ký số (đã là `upload`).
- Cùng luật, 2 quy trình demo có bước «Gửi đối tác» sẽ vướng REAL_ACTION (bước «Chọn đối tác» ngay trước là `auto`, không phải duyệt) ⇒ bước đó nay có `after: reviewNew(PARTNER_PICK_GROUP)`.
- `call` ở `tools/hub-dev/src/fixture.ts` in kèm `details` (paths/rules) của lỗi 4xx.
- Test `seed-demo-partner.flow.test.ts`: 4 quy trình seed qua zod + `validateProcessDef` + `flowDefPaths` (def tool dựng tay theo tham số thật).

## Không làm / Chạm
Không sửa code sản phẩm. Không chạy seed trên staging. Người phụ trách `owner_user_id` kiểm ở DB (không dựng trong unit).

## Test tối thiểu
`bun test tools/scripts/src/seed-demo-partner.flow.test.ts tools/scripts/src/seed-demo-partner.data.test.ts`

## Quyết định trong lúc làm
Tham số tool trong test là bản tối thiểu dựng tay (không import registry gói) ⇒ int trên evotest chưa chạy.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa dữ liệu seed UAT)
