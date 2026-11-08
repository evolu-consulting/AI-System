# company flows pair

Cập nhật: 2026-11-08 · Nguồn: cr122-n1-module-nodes. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Bản gốc và bản sao không bao giờ cùng Bật
Bật bằng PATCH bị chặn khi bản đối ứng đang Bật (409 `FLOW_PAIR_ACTIVE`, câu sửa) hoặc khi bản sao chưa xuất bản (409 `FLOW_NOT_PUBLISHED`).
- Kịch bản: khi PATCH bật gốc sau khi xuất bản bản sao, hoặc bật bản chưa xuất bản, thì 409 [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » soát B1: bản gốc và bản sao không cùng Bật qua PATCH, bản chưa xuất bản không PATCH bật được]
