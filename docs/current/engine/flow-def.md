# flow def

Cập nhật: 2026-11-08 · Nguồn: cr122-f0-flowdef-contract. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Một định dạng FlowDef có node Bắt đầu khi và Kết thúc (FLOW2-FR-01/02/12/15)
Flow (Thư viện, bản công ty, mẫu chạy thử) có đúng một `trigger {event, when?}`, `stages` theo định dạng engine cộng `next_step` (bước gộp) và `outcome` (node Kết thúc); ≤ 20 bước, ≥ 1 Kết thúc; điều kiện AND/OR lồng một cấp trên dữ kiện app khai. Def/snapshot cũ không có `trigger` vẫn đọc được để chạy nốt.
- Kịch bản: khi flow có 1 trigger và ≥ 1 Kết thúc thì hợp lệ [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » hợp lệ: 1 trigger, ≥ 1 Kết thúc ⇒ ok, không legacy, mặc định source/version null]
- Kịch bản: khi không có node Kết thúc thì từ chối [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » không có node Kết thúc ⇒ FLOW_NO_FINISH]
- Kịch bản: khi quá 20 bước thì từ chối [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » > 20 bước ⇒ FLOW_TOO_MANY_STEPS, đúng 20 ⇒ hợp lệ]
- Kịch bản: khi `next_step` lùi hoặc Kết thúc đi tiếp thì từ chối, gộp nhánh tiến về sau thì hợp lệ [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » next_step lùi/vượt ⇒ FLOW_NEXT_STEP_INVALID, Kết thúc có next_step ⇒ FLOW_FINISH_NEXT]
- Kịch bản: khi sự kiện/kết quả/dữ kiện không thuộc manifest app thì báo lỗi đúng vị trí [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » theo manifest: sự kiện lạ, outcome không thuộc sự kiện, dữ kiện/kiểu sai ⇒ lỗi tương ứng]
- Kịch bản: khi def cũ không có trigger thì vẫn hợp lệ để chạy snapshot [test: packages/contracts/src/hub-admin/process-flowdef.test.ts » không trigger, có slot/after.branch ⇒ hợp lệ legacy, giữ trường khác, không áp luật mới]
