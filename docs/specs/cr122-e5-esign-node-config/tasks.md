---
id: cr122-e5-esign-node-config
lát: cr122-e5-esign-node-config
cr: CR-122
làn: nhanh
migration: không
phụ thuộc: E3 (node Ký số = tool gửi + chờ sự kiện), N1 (manifest nodes)
---
## Plan (ngắn)
Node Ký số có cấu hình RIÊNG: nhà cung cấp (chọn trong các nhà cung cấp đang bật), người ký phía công ty (người/Group), đối tác ký, thứ tự (song song/tuần tự), hạn, nhắc.
Mọi trường tuỳ chọn; trống ⇒ cài đặt ký số chung của app như trước. Cấu hình nằm ở `args` của stage tool `contracts-esign-send`; args GHI ĐÈ cài đặt app.

## Làm
- Contract `packages/contracts/src/pack-contracts/esign-node.ts`: `EsignNodeConfigSchema` (logic, mảng), `encodeEsignNodeArgs`/`decodeEsignNodeArgs` (args chỉ nhận giá trị đơn ⇒ `company_signers` = chuỗi `user:<uuid>,group:<uuid>`), `esignWaitTimeoutH`, kiểu `ESignNodeOptionsOut`/`ESignNodeCheckOut`.
- Manifest: `AppNodeDecl.config { stage, options_path }` (luật `node_config` ở `nodes.rules.ts`); node `contracts.esign` khai `{ stage: 0, options_path: "/pack/contracts/esign/options" }`.
- Tool `contracts-esign-send` khai 6 tham số tuỳ chọn (để lưu def cho phép args) và đọc args: `provider`, `company_signers` (người/Group ⇒ user, kiểm thuộc công ty ở runtime), `partner_signs`, `order`. Không args ⇒ đúng đường cũ.
- `esign.usecase`: `sendSystem(..., provider, node)`; `storedSigners` nhận nhiều người ký công ty + song song (cùng `order` 1). `esign-node.usecase.ts`: `nodeOptions`, `checkNode`, `resolveNodeSigners`. `esign-node.repo.ts`: Group + giải mục người ký (1 câu SQL, `tenant_id` tường minh).
- Route: `GET /pack/contracts/esign/options`, `POST /pack/contracts/esign/node-config/check`.

## Hợp đồng API cho panel node (agent UI)
- **Lưu ở đâu:** node `contracts.esign` ⇒ stage 0 (tool). Panel đọc `node.config.stage` + `node.config.options_path` từ manifest; ghi `executor.args` của stage đó bằng `encodeEsignNodeArgs(config)` (mỗi arg `{ from: "const", value }`; giữ `contract_id` như cũ). Đọc lại: `decodeEsignNodeArgs(argsConstValues)`.
- **Lấy lựa chọn:** `GET /pack/contracts/esign/options` (quyền `read` gói) ⇒ `ESignNodeOptionsOut`:
  `{ providers:[{key,label,kind,legal}] /* chỉ đang bật */, default_provider, enabled, groups:[{id,key,name}], orders:["parallel","sequential"], limits:{signers_max:3,due_days_max:90,remind_hours_max:720} }`.
  Ô chọn: nhà cung cấp (mục đầu "Theo cài đặt chung" = bỏ trống), người ký công ty (người cụ thể từ danh sách thành viên chung của shell + Group từ `groups`; tối đa `signers_max`), Đối tác ký (Có/Không/Theo email liên hệ = bỏ trống), Thứ tự, Hạn (ngày), Nhắc mỗi (giờ). `enabled=false` ⇒ hiện lý do "công ty chưa bật ký số" + cách bật (Cài đặt › Ký số).
- **Kiểm trước khi lưu def:** `POST /pack/contracts/esign/node-config/check` (quyền `write`), body = `EsignNodeConfig` (logic) ⇒ `{ issues:[{field, code}] }`; `code` ∈ `ESIGN_DISABLED | PROVIDER_UNAVAILABLE | SIGNER_NOT_IN_TENANT | NO_SIGNER | DIRECTORY_UNAVAILABLE`; rỗng ⇒ hợp lệ. Hiện lỗi cạnh ô `field` (`provider` | `company_signers`).
- **Hạn ký:** khi người dùng đặt `due_days`, panel đặt luôn `timeout_h = esignWaitTimeoutH(config)` cho stage chờ (stage 1) của node.
- Giá trị ngoài giới hạn/sai dạng ⇒ `decodeEsignNodeArgs` trả `issues` theo khoá (không gọi API).

## Không làm / Chạm
- Không đụng engine/settle/node (E2b), triggers (E1b), approval (A1), community (A2), admin-web/workspace-web (UI làm panel theo hợp đồng trên), DLC.
- **Chưa áp ở runtime:** `due_days` và `remind_every_hours` được nhận + kiểm + lưu nhưng CHƯA điều khiển nhắc/hạn của phong bì — vòng nền `esign-sweep` hiện đọc hạn/nhắc từ bước Ký số của luồng duyệt cũ (`flow_steps`), cần cột lưu theo phong bì (migration) ⇒ lát E5b. Hạn chờ của node đã chạy được qua `timeout_h` của stage chờ.
- Lưu def (company-flow save của E1b) chưa tự gọi kiểm: dùng `POST …/node-config/check` ở panel trước khi lưu; bước tự kiểm phía server khi lưu def ⇒ nối vào E1b (`PackToolCatalog.validateArgs` nếu cần). Lúc chạy tool vẫn kiểm lại: người ký không thuộc công ty ⇒ ném lỗi, không gửi.

## Test tối thiểu
- unit: `esign-node.test.ts` (logic ⇄ args), `nodes-config.test.ts` (luật `node_config`), `intake.tools.esign-node.test.ts` (tool đọc args).
- int: `adapters/esign-node.int.test.ts` — args ghi đè cài đặt app (nhà cung cấp, người ký, song song) so với không args; người ký ngoài công ty bị từ chối; `options` + `checkNode`.

## Quyết định trong lúc làm
- `args` của stage tool chỉ nhận giá trị đơn (`PackToolArgs`) ⇒ hai dạng cấu hình (logic cho panel, args cho def).
- Group = mọi thành viên còn dùng được (thứ tự theo id), ≤ 3 người ký công ty; mỗi người ký nhúng (`client_user_id`) như người ký công ty hiện có.
- Song song = mọi người ký cùng `order` 1 (envelope DocuSign `routingOrder` trùng); tuần tự = theo danh sách, đối tác sau.

## Delta (so với docs/current)
Trạng thái gộp: đã gộp 2026-11-08 (đợt cr122-cr123)

### ADDED current/pack-contracts/esign-node-config.md
#### Yêu cầu: Node Ký số có cấu hình riêng, ghi đè cài đặt chung
Node Ký số nhận nhà cung cấp, người ký công ty, đối tác ký, thứ tự, hạn, nhắc ở `args` của stage gửi ký; trường trống lấy cài đặt ký số chung của công ty.
- Kịch bản: khi node chỉ định nhà cung cấp và người ký thì phong bì dùng đúng nhà cung cấp và người ký đó, không có cấu hình thì dùng mặc định công ty và người bắt đầu [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » không args ⇒ nhà cung cấp mặc định + người bắt đầu, có args ⇒ nhà cung cấp, người ký, thứ tự theo node]
- Kịch bản: khi người ký thuộc công ty khác thì bị từ chối và không tạo phong bì [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » người ký thuộc công ty khác / không tồn tại ⇒ từ chối, không tạo phong bì]
#### Yêu cầu: Panel node lấy lựa chọn và kiểm cấu hình trước khi lưu
- Kịch bản: khi mở panel thì chỉ thấy nhà cung cấp đang bật và Group của công ty, lưu với nhà cung cấp chưa bật hoặc người ký ngoài công ty thì báo lỗi theo trường [test: apps/hub-api/src/modules/packs/contracts/adapters/esign-node.int.test.ts » GET options: chỉ nhà cung cấp đang bật + mặc định, kiểm cấu hình khi lưu def báo lỗi theo trường]
- Kịch bản: khi đọc args thì tool áp đúng cấu hình và từ chối cấu hình sai [test: apps/hub-api/src/modules/packs/contracts/adapters/intake.tools.esign-node.test.ts » cấu hình sai ⇒ lỗi rõ theo khoá, không gửi]

## Việc còn lại
- UI panel node (agent UI) theo hợp đồng API ở trên.
- E5b: lưu hạn/nhắc theo phong bì để `esign-sweep` áp (migration) + nối kiểm vào lưu def phía server (E1b).
