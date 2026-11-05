---
id: cr121-d0-slot-contract
lát: cr121-d0-slot-contract
cr: CR-121
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Ranh giới cho CR-121 D (spec: `docs/specs/cr121-d/spec.md`): `SlotSpec.fields/nodes` + khai cho khe `contracts.approval`; `FlowCond`/`FlowWhen`
mở rộng (phòng ban người tạo, đối tác mới, nhóm lồng một cấp) tương thích ngược; bất biến trần bước ↔ trần stage engine.

## Làm
- [x] `slot.ports.ts`: `SlotField`/`SlotNode` + `fields?`/`nodes?` + `slotFields`/`slotNodes` (vắng ⇒ rỗng, khe khác không đổi).
- [x] `approval-slot-catalog.rules.ts` + gán vào `approvalSlotSpec`.
- [x] `@ai/contracts`: `FLOW_COND_FIELDS`, `FlowCondSchema` 4 trường, `FlowCondGroupSchema`, `FlowWhenSchema` lồng một cấp, `flowLeafConds`,
      `isFlowCondGroup`, `APPROVAL_FLOW_SYSTEM_STAGES`; `FlowSkipCondSchema` thêm `is` + boolean.
- [x] Bản sao domain + `condHolds`/`whenHolds`/`condHasData` (trống ⇒ đúng) + consumer chỉnh kiểu tối thiểu (hub, admin-web, workspace-web, flow-canvas).
- [x] Spec D-0..D-5 + bảng file sở hữu.

## Không làm / Chạm
Không đổi trần 8/10 (cần migration hub ⇒ D-1). Không SQL, không int. Không đụng DLC/Community.

## Test tối thiểu
`bun test packages/contracts/src/pack-contracts/approval-flow-cond.test.ts apps/hub-api/src/modules/packs/contracts/domain/approval-slot-catalog.rules.test.ts`
+ unit cũ cùng vùng (domain contracts, kit, admin-web processes/lib, workspace-web contract-approval/settings lib, flow-canvas).

## Quyết định trong lúc làm
- Trần 20 bước KHÔNG nâng ở D-0: CHECK hub (`process_defs_stages_ck` 1..10, `process_runs_step_ck` 0..9, `back_to_step`, `from_step` ≤ 9) chặn ⇒
  nâng hằng mà không migration = def 20 bước lỗi 500 khi lưu. Chuyển sang D-1 (cùng migration + sửa test khoá P-a). D-0 thêm bất biến
  `APPROVAL_FLOW_STEPS_MAX + APPROVAL_FLOW_SYSTEM_STAGES ≤ PROCESS_STAGES_MAX`. `PROCESS_STEP_STAGES_MAX` (=3) là số stage song song/bước — không đổi.
- `creator_department` theo MÃ Group (def thư viện dùng chung nhiều tenant), dữ kiện = mã của người tạo + mọi phòng cha (D-1 dựng).
- Node khai = chỉ node chạy được hôm nay (review, dify, esign); `notify`/`wait_until` có trong kiểu `SlotNodeKind` nhưng chưa khai.
- Hạn thanh toán: không có trường mức HĐ (chỉ `obligations.due_date`) ⇒ không khai.
- Điều kiện mới lưu được qua API ngay sau D-0 nhưng chưa có dữ kiện ⇒ luôn "chưa có dữ liệu" ⇒ bước chạy (an toàn) tới khi D-1 gộp.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/thu-vien-quy-trinh.md
#### Yêu cầu: Danh mục trường điều kiện và node của khe (nguồn: cr121-d0-slot-contract)
Mỗi khe khai các trường nghiệp vụ dùng được trong điều kiện bước (nhãn tiếng Việt, kiểu, toán tử, lựa chọn) và các loại node bằng đúng tính năng app đã chạy được; khe không khai ⇒ rỗng. Khe Sổ Hợp Tác · Duyệt hợp đồng: Giá trị hợp đồng, Loại hợp đồng, Phòng ban người tạo, Đối tác mới; node Duyệt, Trợ lý AI, Ký số.
- Kịch bản: khi khe hợp đồng đăng ký thì có đủ 4 trường và 3 node; khe khác không khai thì danh mục rỗng [test: apps/hub-api/src/modules/packs/contracts/domain/approval-slot-catalog.rules.test.ts » SlotSpec.fields / nodes]
- Kịch bản: khi thân khe có điều kiện trường mới và nhóm lồng thì vẫn kiểm và biên dịch được [test: apps/hub-api/src/modules/packs/contracts/domain/approval-slot-catalog.rules.test.ts » thân khe có điều kiện trường mới + nhóm lồng vẫn kiểm/biên dịch được]

### MODIFIED sht/duyet-ky-so.md
#### Yêu cầu: Điều kiện bước theo trường nghiệp vụ, AND/OR lồng một cấp (nguồn: cr121-d0-slot-contract)
Điều kiện bước nhận thêm phòng ban người tạo (tính cả phòng con, theo mã) và đối tác mới, cùng nhóm AND/OR lồng một cấp; điều kiện cũ (loại HĐ, giá trị) giữ nguyên hình và nghĩa; trường chưa có dữ liệu ⇒ điều kiện coi là đúng (bước vẫn chạy).
- Kịch bản: khi quy trình cũ chỉ có loại HĐ/giá trị thì parse và xét y như trước [test: packages/contracts/src/pack-contracts/approval-flow-cond.test.ts » điều kiện cũ (loại HĐ / giá trị, một cấp) parse ra y nguyên]
- Kịch bản: khi lồng hai cấp hoặc trường lạ thì bị chặn [test: packages/contracts/src/pack-contracts/approval-flow-cond.test.ts » chặn: lồng hai cấp, trường lạ, mã phòng sai dạng, quá số điều kiện]
- Kịch bản: khi chưa biết phòng ban người tạo / đối tác mới thì bước vẫn chạy [test: apps/hub-api/src/modules/packs/contracts/domain/approval-slot-catalog.rules.test.ts » phòng ban người tạo (đã gồm phòng cha) / đối tác mới, chưa có dữ liệu ⇒ đúng]
- Kịch bản: khi "đối tác mới hoặc (phòng KD và ≥ 500 tr)" thì xét đúng từng nhánh [test: apps/hub-api/src/modules/packs/contracts/domain/approval-slot-catalog.rules.test.ts » nhóm lồng một cấp: A hoặc (B và C)]
- Kịch bản: khi số bước vượt trần thì bị chặn, trần bước + 2 stage hệ thống không vượt trần stage engine [test: packages/contracts/src/pack-contracts/approval-flow-cond.test.ts » bước người dùng + route + finalize ≤ trần stage engine, vượt trần ⇒ schema chặn]

## Việc còn lại
- D-1..D-5 theo `docs/specs/cr121-d/spec.md` (trần 20 bước + migration nằm ở D-1).
- Đề xuất D-6: node `notify` / `wait_until` cho khe hợp đồng (loại bước + phần chạy, Opus).
