# company flows

Cập nhật: 2026-11-08 · Nguồn: cr122-e1b-company-flows. Mục "Việc còn lại" nằm ở `docs/specs/<lát>/tasks.md`.

#### Yêu cầu: Danh sách flow của công ty (FLOW2-FR-05..09/20)
Platform admin gán flow Thư viện (đã xuất bản, có Bắt đầu khi) cho công ty; tenant admin xem, bật/tắt, xếp thứ tự, sao chép để sửa, xuất bản bản sao (gốc tự Tắt), quay về bản gốc — mỗi thao tác một tx. Không trỏ được def của công ty khác. Không tắt được flow không điều kiện cuối cùng của sự kiện bắt buộc.
- Kịch bản: khi gán và xem từ công ty khác thì bị chặn, def công ty khác không gán được [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » gán: platform_admin được, tenant_admin 403, vai: member 403, công ty khác 404, def công ty khác 422 và không lộ]
- Kịch bản: khi tắt flow không điều kiện cuối của sự kiện bắt buộc thì 409 [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » tắt flow không điều kiện cuối của sự kiện required ⇒ 409, có flow khác không điều kiện thì tắt được]
- Kịch bản: khi sao chép thì có bản công ty đổi Group theo mã, bấm lại trả bản cũ [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » sao chép để sửa: bản công ty Tắt chưa xuất bản, Group mã → id, lần hai trả bản cũ, công ty thiếu phòng ⇒ 422 nêu mã]
- Kịch bản: khi xuất bản bản sao thì gốc Tắt, quay về thì đảo lại [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » xuất bản bản sao ⇒ bản sao Bật + gốc Tắt (replaced_by), quay về bản gốc ⇒ đảo lại, bản sao giữ (reverted)]
