---
id: cr122-a2b-pack-role-helper
lát: cr122-a2b-pack-role-helper
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: A2
---
## Plan (ngắn)
(1) Tách đổi scope role gói trong tx đang mở của `inCommunityRole` thành `withPackRoleInTx(tx, pack, tenantId, fn)` ở `packs/kit` (export qua `kit/public.ts`)
cho A1 (contracts) dùng chung. (2) Bỏ email (PII) khỏi `hub.flow_events.facts` của `partner.join_requested`.

## Làm
- `packs/kit/adapters/pack-role-in-tx.ts`: bộ `set_config` của `withPackScope`; `fn` ném ⇒ vẫn trả role + `app.*` rồi ném lại lỗi gốc; tx đã hỏng thì bỏ qua lỗi trả (rollback).
  Không `prev as NonNullable` (kiểm `[s]` rỗng ⇒ ném). Community `flow-ports.ts` dùng helper; xoá `inCommunityRole`.
- `joinFacts`: `email` → `email_domain` (tên miền, chữ thường; sai dạng ⇒ null); manifest `community.manifest.ts` đổi khai theo.

## Không làm / Chạm
Không đổi engine/dispatcher/contracts pack. `company_name` giữ (tên doanh nghiệp, điều kiện "Tên công ty" của flow-model).

## Test tối thiểu
unit `flow-events.rules.test.ts` (email_domain, không PII); int `kit/adapters/pack-role-in-tx.int.test.ts` (thành công, fn ném JS, lỗi SQL trong savepoint
mà tx chạy tiếp ⇒ role và app.* đã trả; khoá gói/tenant sai); `community.flow-events.int.test.ts` (facts không chứa email).

## Quyết định trong lúc làm
Email không cần cho điều kiện nào đang có (không flow/seed nào đọc fact `email`) nhưng flow-model liệt kê "email" làm dữ kiện ⇒ giữ khả năng điều kiện
bằng cờ suy ra `email_domain` thay vì bỏ hẳn.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp
Không thay đổi hành vi (lý do: refactor nội bộ; đổi dữ kiện `email`→`email_domain` thuộc sự kiện mới của A2 chưa gộp, đã ghi ở Delta cr122-a2-community).

## Việc còn lại
A1 chuyển `contracts` OutcomeHandler sang `withPackRoleInTx`.
