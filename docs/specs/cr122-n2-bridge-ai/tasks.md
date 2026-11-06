---
id: cr122-n2-bridge-ai
lát: cr122-n2-bridge-ai
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: cr122-n1-module-nodes
---
## Plan (ngắn)
FLOW2-FR-26 phía hub (admin-web: lát UI làm nút "Gợi ý cầu nối"). Ba việc:
1. Kiểm cạnh TẤT ĐỊNH (không AI) — hàm thuần `flowEdgeIssues(def, palette)` ở contracts; khi LƯU def chặn thiếu trường bắt buộc.
2. `POST /process-defs/bridge-suggest` — AI qua Agent Hub đề xuất chèn node Ghi giá trị (`set`); không lưu gì.
3. `POST /process-defs/:id/run` kiểm tính năng của node như đường mở lượt từ sự kiện.

## Hợp đồng API (cho lát UI)
**Contracts** (`@ai/contracts/hub-admin`, `hub-admin/process-flow-edges.ts` + `process-bridge.ts`), thuần, dùng được ở FE:
- `flowEdgeIssues({stages}, palette) → {from, to, missing[], typeMismatch[{key,expected,got}]}[]` — `from`/`to` = khoá stage; `palette` = `items` của `GET /process-palette`. Chỉ cạnh lệch mới có trong kết quả; `missing` ⇒ cạnh đỏ (chặn lưu), chỉ `typeMismatch` ⇒ cạnh vàng (cảnh báo).
- `blockingEdgeIssues(issues)` = cạnh có `missing`. `flowEdges(stages)` = cạnh `[chỉ số, chỉ số][]`. `flowStageOutputs(def, palette)` = trường sẵn có sau mỗi stage.
- `insertBridgeStage(stages, fromKey, toKey, bridgeStage) → {stages, step} | null` — chèn bước mới ngay trước bước của `to`, dời số bước + mọi tham chiếu bước (next_step, Nếu, nhánh, rẽ chờ, Duyệt, quay lại). UI dùng đúng hàm này khi bấm **Nhận**.
- Cạnh = đường đi của engine: bước kế, `next_step`, then/else của Nếu, `after.branch`, `branches` của wait_event, reject/return của Duyệt. Node Nếu/Chờ/Thông báo/Duyệt **trong suốt** (đầu ra gồm cả đầu ra bước trước). Đầu ra stage = `outputs` của node bảng + `output.fields`; đầu vào chỉ đòi khi stage có `node`. Cạnh từ node Bắt đầu khi KHÔNG xét.

**Lưu def** `POST/PUT /process-defs…`:
- thiếu trường bắt buộc ⇒ `422 FLOW_EDGE_MISSING`, `error.details = { edges: [{from,to,missing,typeMismatch}] }` (UI tô cạnh + "Bước sau cần <x>, bước trước không có");
- chỉ lệch kiểu ⇒ 200 + `warnings: [{from,to,missing:[],typeMismatch}]` trong response (`ProcessDefSaved`, vắng khi không có);
- thứ tự lỗi: `PROCESS_DEF_INVALID` → `FLOW_NODE_FEATURE_OFF` → `FLOW_EDGE_MISSING` → các luật tham chiếu. Def không có stage nào mang `node` ⇒ không kiểm (0 việc thêm).

**`POST /process-defs/bridge-suggest?tenant_id=`** (vai admin; `tenant_id` chỉ platform_admin, như `/process-defs`)
- Body `{ def: ProcessDefInput (bản nháp, chưa cần lưu), from: <khoá stage trước>, to: <khoá stage sau> }` — `from→to` phải là MỘT cạnh thật của flow (sai ⇒ 400 `VALIDATION_ERROR`).
- 200 `{ ok: true, stage: ProcessStageDef (set, step = bước mới), explain_vi, explain_en }` | `{ ok: false, reason_vi, reason_en }`. Schema `BridgeSuggestResponseSchema`.
- `ok:false` cả khi: cạnh đã khớp (KHÔNG gọi AI), AI nói không map được (giữ lý do của AI), AI trả sai hình / đề xuất không qua `flowEdgeIssues` + luật `set`, AI chưa nối / hết hạn mức / lỗi / quá 30 s.
- 403 member / tenant khác (404 như defs); 429 `BRIDGE_RATE_LIMITED` (+`Retry-After`) khi > 10 lần/phút/người (cửa sổ trượt trong bộ nhớ, chỉ tính khi thật sự gọi AI).
- Không ghi DB/cấu hình. AI gọi qua `AgentCaller` (AI client chung ⇒ trần token tenant/ngày + usage `flow.bridge`); agent seed `flow-bridge` (`apps/hub-api/seed/agents.yaml`, surface background, sửa prompt/model ở Studio). Đầu vào AI CHỈ có tên/kiểu trường + đầu vào quy trình (key/kiểu): không dữ liệu bản ghi, không tên/nội dung do người dùng đặt.
- UI: người dùng xem `explain_*` + stage → **Nhận** (`insertBridgeStage`, rồi lưu bình thường — lưu chạy lại `flowEdgeIssues`) / **Bỏ**.

**`POST /process-defs/:id/run`**: node của tính năng đã tắt ⇒ `422 FLOW_NODE_FEATURE_OFF` (giống `flow-launch`), không mở lượt.

## Làm
contracts: `process-flow-edges.ts`, `process-bridge.ts`, `FLOW_EDGE_MISSING`, `ProcessDefSavedSchema` (= `ProcessDef` + `warnings`). hub: `processes/bridge/*` (rules, service, routes, mount), `defs/edge-check.ts`, `defs.service` (kiểm cạnh + chạy tay), seed agent `flow-bridge`, `AI_FEATURES += flow.bridge`, nối `bridgeAgent` ở `app.ts` → `ProcessDeps`.

## Không làm / Chạm
Không đụng admin-web, engine run (set/if), DLC. `set` chỉ đọc đầu vào lượt chạy hoặc hằng (`SetFrom = input | const`) ⇒ cầu nối map được từ **đầu vào quy trình**/hằng, CHƯA từ field của stage trước (xem Việc còn lại).

## Test tối thiểu
unit `process-flow-edges.test.ts` (contracts), `bridge.routes.test.ts` (Hono thật + Agent Hub giả, không DB), `seed.test.ts` (đếm agent); int `defs-flow.int.test.ts` (FLOW_EDGE_MISSING, warnings, chạy tay tắt tính năng).

## Quyết định trong lúc làm
- Chỉ `missing` chặn lưu; `typeMismatch` là cảnh báo (đúng brief).
- Node điều khiển trong suốt để không báo sai khi giữa hai node có Nếu/Chờ.
- Bridge `step` = bước của `to`; mọi lối vào bước đó (kể cả nhánh khác) đi qua cầu nối — nếu anh em song song của `to` mất đầu vào do đó thì đề xuất bị loại (`ok:false`).
- Giới hạn tần suất trong bộ nhớ (một instance); lưới chính là trần token tenant của AI client.

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### ADDED engine/flow-bridge.md
#### Yêu cầu: Nối hai node lệch giao diện: kiểm tất định khi lưu và gợi ý cầu nối bằng AI (FLOW2-FR-26)
Mỗi cạnh của flow được kiểm tất định (không AI): bước sau thiếu trường bắt buộc mà bước trước không có ⇒ chặn lưu 422 `FLOW_EDGE_MISSING`; chỉ sai kiểu ⇒ lưu được kèm `warnings`. `POST /process-defs/bridge-suggest` nhờ AI (qua Agent Hub) đề xuất chèn node Ghi giá trị làm cầu nối; kết quả đã kiểm lại, không lưu gì, AI chỉ thấy tên/kiểu trường.
- Kịch bản: khi bước sau cần trường bắt buộc mà bước trước không có thì cạnh bị báo thiếu, có đủ thì sạch [test: packages/contracts/src/hub-admin/process-flow-edges.test.ts » bước sau (Ký số) cần contract_id mà bước trước không có ⇒ missing, có đủ ⇒ sạch]
- Kịch bản: khi giữa hai node có node Chờ thì dữ liệu bước trước đi qua [test: packages/contracts/src/hub-admin/process-flow-edges.test.ts » node điều khiển (Chờ khoảng) trong suốt: dữ liệu của bước trước đi qua]
- Kịch bản: khi chèn cầu nối vào một cạnh thì số bước và tham chiếu bước dời đúng [test: packages/contracts/src/hub-admin/process-flow-edges.test.ts » chèn vào cạnh a→b: cầu nối ở bước 1, b/c dời +1, nhánh goto cập nhật, hết lệch]
- Kịch bản: khi lưu flow thiếu trường bắt buộc thì 422 FLOW_EDGE_MISSING và không ghi [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » thiếu trường BẮT BUỘC ⇒ 422 FLOW_EDGE_MISSING nêu cạnh + trường, không ghi, đủ trường ⇒ lưu, không warnings]
- Kịch bản: khi chỉ lệch kiểu thì vẫn lưu và trả warnings [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » sai kiểu (field `date` là chuỗi, Hẹn giờ cần date) ⇒ vẫn lưu, response có warnings]
- Kịch bản: khi gợi ý cầu nối hợp lệ thì trả stage set + giải thích vi/en, AI chỉ nhận tên/kiểu trường [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » đề xuất hợp lệ ⇒ stage set (bước 1), giải thích vi+en, qua Agent Hub, prompt chỉ có tên/kiểu trường]
- Kịch bản: khi hai bước đã khớp thì không gọi AI [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » hai bước đã khớp ⇒ ok:false, không gọi AI, cạnh không có thật ⇒ 400]
- Kịch bản: khi AI không map được hoặc trả sai thì ok:false kèm lý do [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » AI nói không map được ⇒ giữ lý do, AI trả sai hình / map sai kiểu / lỗi / hết trần ⇒ ok:false]
- Kịch bản: khi người dùng không phải admin, khác công ty, hoặc gọi quá nhanh thì bị từ chối [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » vai + tenant: member 403, tenant_admin sang tenant khác 404, platform_admin chọn tenant, tần suất 10/phút ⇒ 429]
#### Yêu cầu: Chạy tay một quy trình kiểm tính năng của node như đường mở lượt từ sự kiện (FLOW2-FR-25)
`POST /process-defs/:id/run` từ chối 422 `FLOW_NODE_FEATURE_OFF` khi một node của quy trình thuộc tính năng đã tắt cho công ty.
- Kịch bản: khi chạy tay quy trình có node của tính năng đã tắt thì 422 và không mở lượt [test: apps/hub-api/src/modules/processes/defs/defs-flow.int.test.ts » chạy tay: node của tính năng đã tắt ⇒ 422 FLOW_NODE_FEATURE_OFF, không mở lượt]

## Việc còn lại
- UI (lát agent UI): nút "Gợi ý cầu nối" + cạnh vàng/đỏ + xem trước Nhận/Bỏ; e2e hành trình thật (D5) chạy một lần cuối đợt.
- Engine (Opus, ngoài lát): `SetFrom` chưa có nguồn `{field: {stage_key, field}}` ⇒ cầu nối chưa copy được giá trị từ field của bước trước (chỉ đầu vào lượt chạy/hằng). Thêm nguồn đó ở contracts + `nodes/set/launch.ts` thì prompt/`verifyBridge` mở rộng theo (một chỗ: `bridge.rules.ts`).
- Seed: agent `flow-bridge` có trong `agents.yaml`; môi trường đã seed cần chạy lại seed để có agent (thiếu ⇒ gợi ý trả `ok:false` "chưa sẵn sàng").
