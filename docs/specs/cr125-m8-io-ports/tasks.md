---
id: cr125-m8-io-ports
lát: cr125-m8-io-ports
cr: CR-125
làn: nhanh
migration: không
phụ thuộc: m1, m2, m4, m5
---
## Plan (ngắn)
Mọi node trong `MODULES` khai ĐỦ cổng vào + cổng ra (zod/kiểu `AppNodeIo`, nhãn nghiệp vụ vi/en) để bước sau tự nhận dữ liệu bước trước (MOD-FR-12). Sổ module kiểm khai báo × máy chủ ghi thật (`MOD_OUTPUT_UNBOUND`). Engine KHÔNG đổi: đầu ra máy chủ chưa ghi được đánh dấu `pending` (không phải nguồn tự nối) tới khi lát Opus làm.

## Làm
- contracts: `AppNodeIo.pending`; cổng ra Duyệt (decision, decided_by, feedback), Ký số (event, signed_at, signer, envelope_id), Gửi đối tác (event, partner_reason, round), Thông báo (sent_to); nhãn + `fix` cho đầu vào bắt buộc; `MOD_OUTPUT_UNBOUND` hai chiều trong `moduleIssues`; `mapSourcesAt`/`ancestorsOf` (nguồn = Bắt đầu khi + đầu ra các bước TRƯỚC theo topo) + `flowMapSources` (flow thật từ sổ); `stageOwnOutputs` bỏ `pending`.
- hub-api: `NodeBinding.outputs` + registry gom vào tóm tắt; `CORE_WRITTEN_OUTPUTS` (Duyệt); Ký số/Gửi đối tác khai `event`; `approveFields` ghi thêm `feedback` vào output bước Duyệt (cùng câu UPDATE đã có, không đổi trạng thái run).
- tools: `staticBound` (check:modules) coi đầu ra không pending là đã ghi; scaffold `module:new` có khối inputs/outputs mẫu (pending).
- admin-web: `lib/auto-bind.ts` `mapSources` bỏ đầu ra pending (1 dòng, không đụng canvas).

## Không làm / Chạm
Không chạm canvas admin-web (m6b), DLC, email/trang công khai đối tác, engine timer/notify. Không migration.

## Việc còn lại cho Opus (chạm run-state, đã `pending`)
- Ký số `signed_at`/`signer`/`envelope_id`: ghi vào output bước chờ khi `esign.completed` (stage-timer `waitMd` + dữ liệu phong bì); `envelope_id` còn cần tool `contracts-esign-send` trả về.
- Gửi đối tác `partner_reason`/`round`: ghi vào output bước chờ / khai `output.fields` cho stage tool (hiện `AppNodeStage` không có `output`).
- Thông báo `sent_to`: node `notify` (launch.ts) ghi người nhận vào output; template `{khoá}` hiện chỉ đọc input của lượt, chưa đọc output bước trước.
Làm xong: thêm khoá vào `outputs` của binding + bỏ `pending` ở node.ts (sổ module kiểm hai chiều) + sửa danh sách trong io-ports.test.ts.

## Test tối thiểu
unit: io-ports.test (contracts), modules-tool.rules.test, module-registry.test, packs.modules-outputs.test, approve-out.test; int server: packs.module-registry.int.test (boot thật, verify 0 lỗi).

## Quyết định trong lúc làm
- Thiếu khả năng ghi ở engine ⇒ khai đủ cổng nhưng `pending` thay vì bỏ cổng hoặc làm hỏng boot; sổ kiểm hai chiều để không có cổng "ma".
- `outcome`/`partner_outcome` = trường `event` hiện có của bước chờ (đổi tên sẽ đổi `WAIT_EVENT_FIELD` mà luật rẽ nhánh dùng) ⇒ giữ khoá `event`, nhãn nghiệp vụ «Kết quả ký» / «Phản hồi của đối tác».
- Cụm nhiều stage cùng node (Ký số) chỉ tính đầu ra một lần (stage cuối cụm) để không thành «nhiều nguồn».

## Delta (so với docs/current)
Trạng thái gộp: chưa gộp

### MODIFIED engine/flow-engine.md
#### Yêu cầu: Cổng vào/ra đủ cho mọi node và tự nối từ bước trước
Mỗi node trong sổ module khai đủ đầu vào + đầu ra có nhãn nghiệp vụ vi/en; đầu ra máy chủ chưa ghi được đánh dấu chờ và không làm nguồn tự nối. Tự nối đầu vào lấy nguồn từ «Bắt đầu khi» và đầu ra các bước đứng trước; nhiều nguồn hoặc không có thì hỏi bằng câu nghiệp vụ.
- Kịch bản: Thông báo cần «Thời điểm ký», đúng một bước Ký số phía trước cấp ⇒ nối luôn; hai bước cùng cấp ⇒ hỏi chọn; không bước nào ⇒ «thêm bước Ký số trước» [test: packages/contracts/src/modules/io-ports.test.ts » tự nối từ đầu ra các bước trước]
- Kịch bản: mọi cổng của mọi node có nhãn vi/en và đầu vào bắt buộc có cách khắc phục [test: packages/contracts/src/modules/io-ports.test.ts » cổng đủ nhãn nghiệp vụ]
- Kịch bản: flow Duyệt → Ký số → Thông báo ⇒ nguồn tại Thông báo gồm kết quả duyệt, kết quả ký (một lần), không gồm cổng chờ [test: packages/contracts/src/modules/io-ports.test.ts » flowMapSources · flow thật từ sổ MODULES]

#### Yêu cầu: module:new sinh khối cổng vào/ra
Scaffold node mới có khối inputs (nhãn + cách khắc phục) và outputs (nhãn, đầu ra mẫu đánh dấu chờ) để hub lên ngay.
- Kịch bản: nodeSource có outputs với nhãn vi/en và pending [test: tools/scripts/src/modules-tool.rules.test.ts » module:new · cổng vào/ra (CR-125 m8)]

### MODIFIED engine/flow-runtime.md
#### Yêu cầu: Khởi động dừng khi node khai đầu ra mà máy chủ không ghi
Binding khai các khoá đầu ra máy chủ thật sự ghi; khai báo và binding lệch (thiếu, thừa, hoặc còn đánh dấu chờ) ⇒ MOD_OUTPUT_UNBOUND, hub không lên, câu tiếng Việt nói node, cổng và file cần sửa. Bước Duyệt ghi thêm góp ý của người duyệt vào dữ liệu của bước.
- Kịch bản: binding không ghi đầu ra đã khai ⇒ «Khởi động dừng» kèm câu MOD_OUTPUT_UNBOUND [test: apps/hub-api/src/modules/packs/kit/adapters/module-registry.test.ts » MOD_OUTPUT_UNBOUND (CR-125 m8)]
- Kịch bản: sổ thật (core + Ký số + Gửi đối tác + Hiện bài) × binding thật ⇒ không lỗi đầu ra [test: apps/hub-api/src/modules/packs/packs.modules-outputs.test.ts » đầu ra khai báo × binding thật]
- Kịch bản: Duyệt ghi quyết định + người duyệt + góp ý (trống ⇒ không có khoá) [test: apps/hub-api/src/modules/processes/gates/approve-out.test.ts » approveFields (CR-125 m8 · đầu ra Duyệt)]
- Kịch bản: hub mount thật ⇒ verify 0 lỗi, binding Duyệt/Ký số/Gửi đối tác khai đúng đầu ra [test: apps/hub-api/src/modules/packs/packs.module-registry.int.test.ts » sổ module · mount thật]


