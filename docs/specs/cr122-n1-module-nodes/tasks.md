---
id: cr122-n1-module-nodes
lát: cr122-n1-module-nodes
cr: CR-122
làn: nhanh (contract + API đọc; migration chỉ nới CHECK)
migration: 0110
phụ thuộc: F0, E1b, E3
---
## Plan (ngắn)
FLOW2-FR-25: bảng node = node lõi + node của module tính năng có sẵn (manifest `nodes[]`), chỉ hiện node của tính năng đang bật; node tắt ⇒ lỗi rõ khi lưu/chạy. Kèm `edgeIssues` cho FR-26 (N2 dùng). Nới CHECK xuất bản cho flow theo sự kiện. Sửa Blocker B1 của E1b (commit riêng).

## Làm
- B1 (commit `fix(CR-122 E1b)`): bật bằng PATCH khoá cặp bản sao → gốc, chặn cùng Bật (`FLOW_PAIR_ACTIVE`) và chặn bật bản chưa xuất bản (`FLOW_NOT_PUBLISHED`); mã Group truyền bằng jsonb.
- 0110: `process_defs_published_ck` = có bản xuất bản ⇒ có khe HOẶC có `trigger`; bỏ `slot` tạm trong test def Thư viện.
- Contracts: `AppNodeDecl` (nhãn vi/en, nhóm, 1..3 stage mẫu với executor có sẵn + cấu hình đặt sẵn, `feature`, `inputs`/`outputs`), `CORE_NODES` (Gửi email, Thông báo chuông, Hẹn giờ, Chờ khoảng), `contracts.esign` (tool `contracts-esign-send` + `wait_event` `also_events`), sự kiện `esign.completed|declined|voided` trong manifest contracts, `community.show-post` (Kết thúc `shown`); `appNodeIssues`, `nodesFor`, `nodeByKey`, `edgeIssues`; stage thêm `node` (khoá node bảng); lỗi `FLOW_NODE_FEATURE_OFF`.
- Hub: `GET /process-palette?app=&tenant_id=`; kiểm tính năng khi lưu def (`defs.service`) và khi mở lượt (`flow-launch`, `candidatesOf` gom `stage.node`); `check:app-events` kiểm thêm `nodes[]`.

## Quyết định trong lúc làm
- Khoá tính năng của node = feature catalog CR-111 (`tenantFeatureOn`, cache, 0 SQL): Ký số = `contracts-write`, Hiện bài = `community-write` (gói chưa có feature riêng cho ký số).
- "Hiện bài" không có tool ⇒ node Kết thúc đặt sẵn `outcome: shown` (OutcomeHandler của community làm việc hiện bài).
- Chỉ sửa manifest contracts/community (không đụng events/handler của A1/A2).
- Def Thư viện (tenant null) không kiểm tính năng lúc lưu (không có công ty); kiểm lúc mở lượt cho từng công ty ⇒ `refused: FLOW_NODE_FEATURE_OFF:<node>`.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED current/engine/node-palette.md
#### Yêu cầu: Bảng node gồm node lõi và node của tính năng đang bật (FLOW2-FR-25/26)
Trình sửa lấy bảng node qua `GET /process-palette`: node lõi + node của app có tính năng đang bật cho công ty. Bước dùng node của tính năng đã tắt bị chặn khi lưu (422 `FLOW_NODE_FEATURE_OFF`, nêu tính năng) và không mở lượt. Nối hai node kiểm bằng `edgeIssues` (thiếu đầu vào bắt buộc / lệch kiểu).
- Kịch bản: khi công ty chưa có tính năng thì bảng node không hiện node đó [test: apps/hub-api/src/modules/processes/library/palette.routes.test.ts » tenant_admin: lõi + Ký số (contracts-write bật), không Hiện bài (community-write chưa cấp)]
- Kịch bản: khi lưu bước của tính năng đã tắt thì 422 nêu tính năng [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » N1 · bước là node của tính năng đã tắt ⇒ 422 FLOW_NODE_FEATURE_OFF nêu tính năng, node bật ⇒ lưu được]
- Kịch bản: khi nối hai node lệch giao diện thì báo thiếu/lệch kiểu [test: packages/contracts/src/app-manifest/nodes.rules.test.ts » đủ và khớp kiểu ⇒ rỗng, thiếu đầu vào bắt buộc ⇒ missing, khác kiểu ⇒ type, không bắt buộc thiếu ⇒ bỏ qua]
- Kịch bản: khi khai node sai thì check:app-events đỏ [test: packages/contracts/src/app-manifest/nodes.rules.test.ts » khai sai ⇒ mã luật, khoá trùng / khác tiền tố app]

### MODIFIED current/engine/company-flows.md
#### Yêu cầu: Bản gốc và bản sao không bao giờ cùng Bật
Bật bằng PATCH bị chặn khi bản đối ứng đang Bật (409 `FLOW_PAIR_ACTIVE`, câu sửa) hoặc khi bản sao chưa xuất bản (409 `FLOW_NOT_PUBLISHED`).
- Kịch bản: khi PATCH bật gốc sau khi xuất bản bản sao, hoặc bật bản chưa xuất bản, thì 409 [test: apps/hub-api/src/modules/processes/library/company-flows.int.test.ts » soát B1: bản gốc và bản sao không cùng Bật qua PATCH, bản chưa xuất bản không PATCH bật được]

## Việc còn lại
- Chạy thủ công (`POST /process-defs/:id/run`) chưa kiểm tính năng của node (chỉ lưu + lượt từ sự kiện).
- Trình sửa (U2) cần ghi `stage.node` khi chèn node từ bảng để kiểm tính năng chạy được.
