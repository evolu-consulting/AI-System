# dich buoc flow

Cập nhật: 2026-11-08 · Nguồn: cr122-u2b-canvas-nodes. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Đích bước giữ đúng khi đổi thứ tự (FLOW2-FR-12)
Chèn, kéo hoặc xoá bước thì mọi đích (Từ chối/Trả lại của Duyệt, Gộp tới, Nếu, kết quả chờ) được cập nhật; đích bị xoá về chưa chọn.
- Kịch bản: khi chèn bước ở giữa thì đích sau đó dời một bước [test: apps/admin-web/src/features/processes/lib/step-refs.test.ts » chèn bước ở giữa ⇒ mọi đích tới bước sau đó dời +1, đích trước đó giữ]
- Kịch bản: khi xoá bước đích thì đích về chưa chọn [test: apps/admin-web/src/features/processes/lib/step-refs.test.ts » xoá bước đích ⇒ đích về chưa chọn (không trỏ sai)]
