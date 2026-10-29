---
id: fnr-fix-if
lát: fnr-fix-if
cr: CR-103
làn: nhanh
migration: không
phụ thuộc:
---
## Plan (ngắn)
Hai sửa lỗi review của `fnr-if`: (1) luật def node If cho đích `real_action` khớp runtime; (2) `kick` không dừng ở 4 lượt khi chuỗi node đồng bộ (if/set) dài.

## Làm
- `domain/if/if.rules.ts` (`targetOk`) + contract `ifStageIssues`: chặn mọi `then_step`/`else_step` (kể cả else ngầm = bước kế) trỏ tới bước có stage `real_action`; vì `realActionPre` dùng `effectivePrevStep` ⇒ bước trước có hiệu lực của đích nhảy tới là bước If (auto) ⇒ luôn hỏng. Parity BE ≡ FE giữ.
- `runs/launcher.ts` `kick`: lượt đồng bộ (`events` + `more`) đếm trần riêng `PROCESS_STAGES_MAX`; lượt bất đồng bộ giữ trần `PROCESS_STEP_STAGES_MAX + 1` như cũ.

## Không làm / Chạm
Không đổi luật `after.branch`, không đổi loại bất đồng bộ.

## Test tối thiểu
`domain/if/if.rules.test.ts` (ca then / else ngầm real_action), `defs/if-def-parity.test.ts`, int `if.int.test.ts` (6 If liên tiếp một lượt kick); `test:int:par` processes + P-d/d2.

## Quyết định trong lúc làm
- Chặn thẳng mọi đích `real_action` thay vì xét bước trước đích: runtime không bao giờ cho qua.
- `kickOnce` trả `{ more, sync }`; trần đồng bộ = số stage tối đa của def.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

Không thay đổi hành vi (lý do: sửa lỗi review CR-103 — luật def If khớp runtime và kick chuỗi node đồng bộ; hành vi đặc tả "Node If" không đổi)

## Việc còn lại
Không.