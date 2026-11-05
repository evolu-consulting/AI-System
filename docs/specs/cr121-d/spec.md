---
id: cr121-d
cr: CR-121 (phần D — Quy trình đủ mạnh, chạy chắc)
trạng thái: D-0 xong (ranh giới); D-1..D-5 chờ
nguồn quyết định: docs/CHANGE-REQUESTS.md dòng CR-121 phần D (người dùng chốt 2026-11-05)
---
# CR-121 D · Quy trình duyệt HĐ đủ mạnh, chạy chắc

## Mục tiêu
Platform admin dựng nhiều quy trình duyệt HĐ khác nhau, gán cho từng tenant; mỗi bước có điều kiện theo **trường nghiệp vụ** (giá trị HĐ,
loại HĐ, phòng ban người tạo, đối tác mới), AND/OR lồng một cấp; tối đa **20 bước**; trình sửa chỉ cho thêm **node** đúng các tính năng
gói đã chạy được; gán ⇒ tự bật duyệt theo quy trình; mỗi lượt có run id + kết quả từng bước.

## Không làm (chốt)
- Không chuyển hợp đồng sang node `if` của engine (rẽ theo input run ⇒ hồi quy khi sửa giá trị giữa lượt). Rẽ vẫn bằng tool
  `contracts-route` đọc giá trị HIỆN TẠI của HĐ mỗi lần rẽ.
- Không chuyển def/run prod: điều kiện cũ `{deal|total_value}` một cấp giữ nguyên hình và nghĩa.
- Community, DLC: ngoài phạm vi. Rẽ nhánh Đúng/Sai sang người khác: đợt sau.

## Hiện trạng đã kiểm (D-0)
| Mục | Kết quả |
|---|---|
| Node `review` (theo phòng/Group, `head_only`) | Có — `compileSlotStages` ⇒ stage tool `contracts-route` + `after.review` |
| Node `dify` (trợ lý AI) | Có — stage tool workflow catalog, `after.auto`; bước sau Dify không điều kiện |
| Node `esign` | Có — tối đa 1, phải là bước cuối; không là stage engine (`finalize.slot.esign`, gói gửi ký sau "Đã duyệt") |
| Node `notify` | **Chưa** — gói không có loại bước, engine không có executor gửi thông báo |
| Node `wait_until` | **Chưa** ở khe HĐ — engine có executor `wait_until`/`wait_for` nhưng `FlowStep` không có loại bước, `fromStages` từ chối |
| Hạn thanh toán | **Không có trường mức HĐ** — chỉ `contracts.obligations.due_date` (nhiều dòng/HĐ) ⇒ không vào v1 |
| Run id + kết quả từng bước | Đã có: `hub.process_runs` (id mỗi lượt) + `hub.stage_runs` (mỗi stage × vòng) + `process_outputs`/task; lượt khe chụp `source_ref` + `rel_version` + `process_def_id` (+ `route_rule_id`) qua `slotRunOf` ⇒ lượt cũ giữ bản cũ. Không thêm gì |
| Trần bước | Gói 8 (`APPROVAL_FLOW_STEPS_MAX`), engine 10 stage (`PROCESS_STAGES_MAX`); stage = bước engine + `route` + `finalize`. `PROCESS_STEP_STAGES_MAX` = 3 là số stage SONG SONG trong một bước — không liên quan, giữ nguyên. Nâng 20/22 cần migration hub nới CHECK ⇒ D-1 |

## Yêu cầu

### R1 · Danh mục của khe (D-0)
`SlotSpec.fields` (key, nhãn tiếng Việt, kiểu `number|enum|department|boolean`, toán tử, lựa chọn enum) và `SlotSpec.nodes` (loại node, nhãn,
khoá icon). Khe không khai ⇒ rỗng (`slotFields`/`slotNodes`). Khe `contracts.approval` v1:
- trường: `total_value` "Giá trị hợp đồng" (ge/gt/le/lt) · `deal` "Loại hợp đồng" (in: Mua hàng/Bán hàng/Giới thiệu) · `creator_department`
  "Phòng ban người tạo" (in, theo MÃ Group, tính cả phòng con) · `new_partner` "Đối tác mới" (is).
- node: `review` "Duyệt" · `dify` "Trợ lý AI" · `esign` "Ký số". `notify`/`wait_until` chỉ khai khi gói có loại bước + phần chạy (ngoài D-1..D-5, đề xuất D-6).

### R2 · Điều kiện mở rộng (D-0 hình, D-1 dữ kiện)
`FlowCond` thêm `{field:"creator_department", in:[mã Group]}` và `{field:"new_partner", is:boolean}`; `FlowWhen.conds` nhận điều kiện lá hoặc
**nhóm lồng một cấp** `{op, conds:[lá]}` (≤ 6 mỗi cấp). Điều kiện cũ parse y nguyên. Dữ liệu trống ⇒ điều kiện ĐÚNG (bước vẫn chạy).
- Kịch bản: def cũ (loại HĐ/giá trị một cấp) parse và chạy như trước.
- Kịch bản: lồng hai cấp / trường lạ / mã phòng sai dạng ⇒ 422.

### R3 · Dữ kiện + kiểm lại khi rẽ/kết thúc (D-1)
Tool `contracts-route` và `contracts-finalize` dựng `FlowFacts` từ HĐ HIỆN TẠI: `deal`, `total_value`, `creator_departments` (mã Group của
người tạo + mọi phòng cha theo `admin.departments.parent_group_id`, một câu SQL), `new_partner` (không có HĐ `approved` nào khác cùng đối tác,
một câu SQL có index). `requiredSteps` ở finalize dùng cùng dữ kiện.
- Kịch bản: 600 tr ⇒ qua bước Giám đốc (≥ 500 tr); sửa còn 100 tr giữa lượt ⇒ lần rẽ sau bỏ qua.
- Kịch bản: người tạo thuộc phòng con của "sales" ⇒ điều kiện `creator_department in [sales]` đúng.
- Kịch bản: HĐ chưa gắn đối tác ⇒ `new_partner` chưa có dữ liệu ⇒ bước chạy.

### R4 · Trần 20 bước (D-1)
`APPROVAL_FLOW_STEPS_MAX` = 20 (contracts + bản sao domain), `PROCESS_STAGES_MAX` = 22 (= 20 + `APPROVAL_FLOW_SYSTEM_STAGES`), migration
hub nới `process_defs_stages_ck` (1..22), `process_runs_step_ck` (0..21), `back_to_step`, `from_step` (≤ 21) + bảng thư viện nếu có CHECK
tương tự; i18n "Tối đa 8 bước" ⇒ 20. Test khoá `tests/acceptance/P-a/step0/rules/contracts-pa.test.ts` (10) do qc sửa cùng lát. DLC giữ
`DLC_STEPS_MAX` riêng (không đụng).
- Kịch bản: quy trình 20 bước xuất bản + chạy hết; 21 bước ⇒ `STEPS_MAX`.

### R5 · Kiểm khi xuất bản VÀ khi gán, tiếng Việt + xem trước (D-2)
Xuất bản và gán cùng chạy `validate` của khe + kiểm Group/trường theo tenant (mã phòng trong điều kiện phải tồn tại ở tenant khi gán).
Lỗi tiếng Việt nói cách sửa (vd "Bước 3: phòng ban 'sales' không có ở công ty X — tạo phòng hoặc đổi điều kiện"). Xem trước đường đi nhận đủ
4 trường; điều kiện thiếu dữ liệu ghi "chưa có dữ liệu" (`condHasData`).
- Kịch bản: gán quy trình có điều kiện phòng không tồn tại ở tenant ⇒ 422 kèm câu sửa.
- Kịch bản: xem trước không nhập phòng ban ⇒ bước có điều kiện phòng ghi "chưa có dữ liệu — bước vẫn chạy".

### R6 · Trình dựng điều kiện (D-3)
Admin-web: chọn trường từ `fields` của khe (Hub trả kèm danh sách khe), toán tử theo kiểu, giá trị (số tiền / chọn loại / chọn phòng theo tên /
có-không), nhóm AND/OR một cấp; chỉ cho thêm node trong `nodes`. Thay `FlowWhenEditor` + `flow-when.ts` (không giữ hai control).
- Kịch bản: thêm nhóm "(phòng KD và ≥ 500 tr) hoặc đối tác mới" ⇒ lưu, mở lại thấy y nguyên.

### R7 · Gán ⇒ tự bật duyệt theo quy trình (D-4)
Gán quy trình khe `contracts.approval` cho tenant ⇒ lượt mới chạy engine, không cần feature `contracts-approval-engine`; gỡ công tắc ẩn
(gate `ENGINE_FEATURE_KEY` + chỗ bật tay ở admin); ops-watch check "tenant có gán mà lượt mới vẫn chạy máy cũ" = lệch.
- Kịch bản: tenant mới được gán ⇒ HĐ mới đi engine ngay; tenant chưa gán ⇒ mặc định khe (như CR-120).

### R8 · Hành trình 2 tenant (D-5)
e2e không giả lập: tenant A gán quy trình "≥ 500 tr qua Giám đốc": HĐ 600 tr qua Giám đốc, 100 tr bỏ qua; tenant B không đổi; sửa quy trình +
xuất bản lại ⇒ lượt đang chạy giữ bản cũ (`rel_version`), lượt mới dùng bản mới; lịch sử từng bước hiện theo run id.

## Lát và file sở hữu (không chồng nhau)
| Lát | Model | File sở hữu (chỉ lát này sửa) |
|---|---|---|
| D-0 ranh giới | Opus | `apps/hub-api/src/modules/packs/kit/application/slot.ports.ts`; `packages/contracts/src/pack-contracts/approval-flow.ts` (FlowCond/FlowWhen + hằng); `packages/contracts/src/flow/view.ts` (`FlowSkipCondSchema` thêm `is`/boolean); `apps/hub-api/src/modules/packs/contracts/domain/{approval-flow.types.ts, approval-slot-catalog.rules.ts}`; chỉnh kiểu tối thiểu ở consumer (`approval-flow-cond.rules.ts` mới tách từ approval-flow.rules, approval-engine-card.rules, approval-flow-view.rules, admin-web `lib/{flow-when,flow-form,library-list}.ts`, flow-canvas `layout/vertical.ts`, workspace-web `contract-approval/lib/{engine-card,flow-view}.ts`, `settings/lib/current-flow.ts`, i18n `contracts/{vi,en}.json` skipReason) |
| D-1 dữ kiện + rẽ + trần 20 | Opus medium | `packs/contracts/domain/approval-flow-cond.rules.ts` (FlowFacts/condHolds, tách ở D-0) + `approval-flow.rules.ts` (requiredSteps/route), `packs/contracts/adapters/approval-engine.tools.ts` + repo đọc dữ kiện (mới: `packs/contracts/adapters/flow-facts.repo.ts`), `application/approval-engine*.usecase.ts` (phần facts), `approval-flow.types.ts` + `approval-flow.ts` (chỉ hằng STEPS_MAX), `packages/contracts/src/chat/processes.ts` (PROCESS_STAGES_MAX), migration hub mới (số do điều phối giao), i18n `v2l.*.json` STEPS_MAX; qc: `tests/acceptance/P-a/step0/rules/contracts-pa.test.ts` |
| D-2 kiểm xuất bản+gán + preview | Sonnet | `processes/library/library-publish.rules.ts`, `library.service.ts` (gán), `preview.routes.ts`, `packs/contracts/domain/approval-flow-stages.rules.ts` (previewPath + "chưa có dữ liệu"), `approval.mount.ts` (`preview`), `SlotSpec.preview` input (thêm trường — sửa slot.ports.ts phần `preview` sau khi D-0 gộp), i18n lỗi khe |
| D-3 trình dựng điều kiện | Sonnet | admin-web `features/processes/components/library/{FlowWhenEditor,FlowStepCard}.tsx`, `lib/flow-when.ts`, `lib/flow-form.ts` (phần when), API danh sách khe trả `fields`/`nodes` (`processes/library/*.routes.ts` phần khe + `packages/contracts/src/hub-admin/process-library.ts` DTO), i18n `process/admin.*.json` |
| D-4 gán bật engine + ops | Sonnet high + Opus low soát | `packs/contracts/approval.mount.ts` (`approvalEngine` gate), `domain/approval-engine.rules.ts`, `ops/*flow-coverage*` (check mới), seed/onboard tenant, admin-web chỗ bật feature tay (gỡ) |
| D-5 e2e 2 tenant | Sonnet | `e2e/**/cr121-d-journey*.spec.ts` (mới) + helper `e2e/_kit` nếu thiếu |

Ghi chú: CR-121 phần B sẽ đưa kit ra `public.ts`; thay đổi `slot.ports.ts` thuộc D-0 (đã gộp trước B). D-2 và D-3 chạy song song được
(không chung file); D-1 trước D-2 (preview dùng `condHasData`/facts); D-4 độc lập D-1..D-3; D-5 cuối.

## Chấp nhận
- D-0: unit `approval-flow-cond.test.ts` + `approval-slot-catalog.rules.test.ts` xanh; typecheck hub-api/admin-web/workspace-web sạch.
- D-1: unit facts/condHolds; int: rẽ theo giá trị hiện tại sau sửa, phòng con, đối tác mới; 20 bước xuất bản + chạy; migration nới CHECK.
- D-2: unit thông điệp; int: xuất bản/gán 422 kèm câu sửa; preview "chưa có dữ liệu".
- D-3: unit lib; e2e editor (viết, chạy cuối đợt).
- D-4: int gán ⇒ engine không cần feature; ops check đỏ khi lệch; Opus low soát diff quyền/dữ liệu.
- D-5: e2e hành trình 2 tenant xanh (R8).
