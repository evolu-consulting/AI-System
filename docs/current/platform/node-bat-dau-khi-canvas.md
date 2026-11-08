# node bat dau khi canvas

Cập nhật: 2026-11-08 · Nguồn: cr122-u2c-canvas-shot. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Bắt đầu khi là node thật trên canvas, Ghi giá trị chọn nguồn (FLOW2-FR-02, FLOW2-FR-26)
Canvas vẽ node "Bắt đầu khi" ở cột đầu; node Ghi giá trị chọn nguồn từ bước trước hoặc dữ kiện kèm kiểu ghi, đích `step` đúng sau khi chèn bước.
- Kịch bản: khi def có nguồn field/dữ kiện và `as` thì lưu lại đủ [test: apps/admin-web/src/features/processes/lib/set-form.test.ts » def → draft → def giữ nguyên từng nguồn và `as`]
- Kịch bản: khi chèn bước giữa thì `step` của nguồn field dời theo [test: apps/admin-web/src/features/processes/lib/set-form.test.ts » chèn bước giữa ⇒ `step` của nguồn field dời theo]
