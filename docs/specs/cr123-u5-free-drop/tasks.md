---
id: cr123-u5-free-drop
lát: cr123-u5-free-drop
cr: CR-123
làn: nhanh
migration: không
phụ thuộc: u4 (đã gộp), cr125 m4 (tự nối đầu vào — việc của agent khác)
---
## Plan (ngắn)
Thả node từ menu / bảng mẫu = node ĐỨNG RIÊNG tại điểm thả (không tự nối, không tự chèn lên cạnh). Nối bằng kéo mũi tên; chèn giữa chỉ bằng nút "+" trên cạnh.

## Làm
1. `StageDraft.free` (chỉ bản nháp) + `lib/free-nodes.ts` — MỘT nguồn: đánh dấu khi thả (`markFree`), gỡ khi có mũi tên tới (`clearFree`, cả cụm Ký số), lỗi `stages.i.free` (`freeErrors` ⇒ `validateDraft`/lỗi hiện ngay), bỏ cạnh vào/ra node đứng riêng + nút gộp thừa (`dropFreeEdges`, `collapseLoneJoins`) ở `ProcessCanvas`.
2. Lưu / "Lưu và áp dụng" còn node chưa nối ⇒ chặn: "Bước «X» chưa được nối — kéo mũi tên từ bước trước tới bước này", node viền lỗi, nút "Đến bước" cuộn tới + chọn bước (toast giữa-trên).
3. Danh sách bước: node module nhiều stage là MỘT dòng (`StepList` dùng `useCollapsed`), không "Chờ ký xong".
4. Mũi tên sai luật bị từ chối kèm lý do: `connectPatch` thêm `realNeeds` (Ký số cần nguồn là bước duyệt; "Bắt đầu khi" → Ký số); mọi lý do từ chối trên canvas hiện bằng toast GIỮA-TRÊN, tự đóng 4 giây (`notifyBrief`); `isValidConnection` luôn cho thả để toast nói lý do (không từ chối im lặng).
5. Lý do Lưu bị chặn ở bản demo (step3-save.png, run4.log): xem "Quyết định".
6. Spec CR-123 FR-04 sửa theo.

## Không làm / Chạm
- Không tự nối đầu vào (m4 của CR-125); không engine / hub-api / migration; không CR-124; không tooling depcruise.
- Cuộn tới bước có; thu phóng (zoom) tới bước chưa có API ở `@ai/flow-canvas` — hàng chờ.
- e2e kéo chuột thật từ cổng ra tới node mới chưa ổn định trong stack hành trình (không gây toast, kéo không bắt đầu kết nối) — e2e chỉ kiểm thả + không cạnh + gợi ý; nối kiểm bằng unit (`u5-free-drop.test.ts`).

## Test tối thiểu
Unit: `lib/u5-free-drop.test.ts`, `lib/canvas-connect*.test.ts`, `lib/u4-canvas-ux.test.ts`; e2e: `e2e/journey-approval/cr123-palette-drop.spec.ts` (thả = đứng riêng).

## Quyết định trong lúc làm
- Lỗi demo "Chọn nguồn cho thông tin này" ở Ký số (`Chưa lưu được — bước «Ký số»`): KHÔNG do canvas / vị trí thả. Node Ký số từ menu mang `args: {}` (manifest `contracts.esign` stage 0) nên tham số bắt buộc `contract_id` của `contracts-esign-send` chưa có nguồn ⇒ `TOOL_INVALID` / `argRequired`. Thiếu: tự nối đầu vào `contract_id` ← bản ghi của sự kiện (việc m4 / CR-125). Tạm thời người dùng chọn nguồn thủ công ở panel Ký số.
- Cờ `free` chỉ ở bản nháp, không gửi Hub: Lưu bị chặn trước khi gửi nên không cần cột/migration.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### MODIFIED engine/flow-web.md
#### Yêu cầu: Thả node từ bảng mẫu là node đứng riêng, nối bằng mũi tên (nguồn: CR-123 FLOW3-FR-04 u5)
Thả một loại node lên canvas tạo node mới ĐỨNG RIÊNG tại điểm thả: không tự nối, không tự chèn kể cả thả lên một cạnh; node hiện gợi ý "Kéo mũi tên để nối bước này". Chỉ kéo mũi tên từ đầu ra bước trước mới nối được (sai luật thì từ chối kèm toast lý do giữa-trên, tự đóng sau 4 giây); chèn giữa hai bước chỉ bằng nút "+" trên cạnh. Lưu còn node chưa nối bị chặn kèm câu chỉ bước; danh sách bước hiện node nhiều stage một dòng.
- Kịch bản: khi thả node từ menu Thêm bước thì chỉ thêm một node, không thêm cạnh và hiện gợi ý nối [test: e2e/journey-approval/cr123-palette-drop.spec.ts » U4 · công ty sao chép flow, mở trình sửa, KÉO 'Thông báo' từ menu Thêm bước thả vào canvas ⇒ thêm một node, node mới nằm trong sơ đồ]
- Kịch bản: khi còn node đứng riêng thì Lưu bị chặn với tên bước và node có lỗi [test: apps/admin-web/src/features/processes/lib/u5-free-drop.test.ts » cùng một nguồn: freeErrors, validateDraft, blockedInfo (tên bước + chỉ số)]
- Kịch bản: khi có mũi tên tới node thì hết đứng riêng, cả cụm Ký số [test: apps/admin-web/src/features/processes/lib/u5-free-drop.test.ts » markFree chỉ đánh dấu uid vừa thả, clearFree gỡ cờ của cả cụm node module]
- Kịch bản: khi nối từ Bắt đầu khi hoặc bước tự động tới Ký số thì bị từ chối [test: apps/admin-web/src/features/processes/lib/u5-free-drop.test.ts » bước tự động tới Ký số bị từ chối, bước duyệt tới Ký số nối được]
- Kịch bản: khi cột có node đứng riêng thì không vẽ nút gộp thừa [test: apps/admin-web/src/features/processes/lib/u5-free-drop.test.ts]

## Việc còn lại
- Thu phóng tới bước khi bấm lỗi (cần API focus ở `@ai/flow-canvas`).
- e2e kéo chuột thật tới cổng ra / nối bằng chuột trong stack hành trình.
- Tự nối đầu vào Ký số (m4) — hết lỗi "Chọn nguồn cho thông tin này".