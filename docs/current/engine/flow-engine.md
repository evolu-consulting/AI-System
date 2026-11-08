# Engine quy trình (flow engine) — hành vi đang chạy

Nguồn: CR-103 (proposal `docs/specs/flow-node-registry/`), các lát `fnr-*`, `fix-pd2-e05`; Delta gộp 2026-10-30 (đợt CR-103). Trạng thái: **đã deploy production `f818487a`** (2026-10-29), sửa sau `0b3ee2de`. Gốc engine (P-a/P-d, HUB-FR-104…) xem `docs/design/**` + CODEMAP; file này chỉ ghi phần CR-103 và nền cần để hiểu nó.
Viết tắt: `HP` = `apps/hub-api/src/modules/processes`, `CT` = `packages/contracts/src/hub-admin`, `AW` = `apps/admin-web/src/features/processes`.

## 1. Khái niệm
- **Quy trình (def)** gồm ≤ 10 giai đoạn (stage, `PROCESS_STAGES_MAX`), mỗi stage thuộc một **bước** (step, 0-based). Một bước chứa ≤ 3 stage chạy **song song** (`PROCESS_STEP_STAGES_MAX`, `CT/processes.ts`).
- Bước chỉ sang bước kế khi mọi stage của bước đó xong (**join**); stage bị nhảy qua chuyển `skipped`; bước "liền trước có hiệu lực" bỏ qua các bước toàn `skipped` (`effectivePrevStep`, `HP/domain/branch/branch.rules.ts`).
- Lượt chạy (run) chạy theo **snapshot** def lúc bắt đầu: sửa def (kể cả đổi loại node) không ảnh hưởng run đang chạy.
- Quyền: editor/lượt chạy chỉ mở cho `tenant_admin` / `platform_admin` (xem mục 8).

## 2. Registry loại node và họ (flow-node-registry, `fnr-registry`)
Lõi engine (`HP/defs`, `runs`, `kh`…) **không rẽ theo `executor.kind`**; chỉ hỏi qua `HP/nodes/registry.ts` (`NODES: {[K in ExecutorKind]: NodeSpec<K>}`, thiếu loại ⇒ lỗi typecheck; test `nodes/registry.test.ts` đỏ nếu contract có loại chưa đăng ký). Thêm loại node = thêm một schema contract + một module `HP/nodes/<kind>/{node,launch}.ts` + một editor FE (`AW/nodes/registry.ts`), không sửa lõi. Loại lạ trong snapshot cũ ⇒ `nodeSpecOf` trả `undefined`.

| Loại | Họ | Sinh field cho bước sau (`NODE_PRODUCES`) | Chạy bằng | `real_action` |
|---|---|---|---|---|
| `agent` | work | khai báo | một agent | được |
| `team` | work | khai báo | nhóm agent (sequential / parallel_merge) | được |
| `tool` | work | khai báo | tool workflow/gói (pipeline `/mcp`) | được |
| `set` | work | khai báo | Hub, không AI | không |
| `wait_until` | wait | không | hẹn giờ | không |
| `apply` | apply | không | stage Áp (PR/tự-sửa) | gắn sau stage tự-sửa |
| `if` | control | không | Hub, tức thì | không |

Họ và `NODE_PRODUCES`: `CT/node-family.ts`. Loại `produces: none` không được có tham chiếu field tới nó (xem mục 6). `set`/`if` ép trường khi lưu (template/mục/answerer/nguồn cố định, `normalizeStage`).

## 3. Node If (`fnr-if`, `fnr-fix-if`)
Node `if` (họ control) đứng **một mình trong bước**, `after = auto`, `real_action = false`, chạy tức thì (không agent/run/output). Schema: `CT/process-if.ts`; luật thuần: `HP/domain/if/if.rules.ts`; chạy: `HP/nodes/if/launch.ts` (stage `done` → `settleStepTx` → kick bước đích sau commit).
- `when = {op: and|or, conds[1..6]}`; mỗi cond `{from, op, value}`, `from` = `field` (stage ở bước **trước** + key field) hoặc `input` (key input của run); `op` ∈ `eq ne lt le gt ge`; ngữ nghĩa so sánh dùng chung `compare` với `after.branch` (NFC + trim, ép số khi luật là số, ngày so chuỗi `YYYY-MM-DD`). Nguồn vắng/`null` ⇒ điều kiện sai.
- `then_step` / `else_step` 0-based, phải nguyên, **> bước của If** và < số bước. `else_step = null` ⇒ Sai thì sang bước kế. Các bước giữa bị `skipped`.
- Hai If nối tiếp đi đúng nhánh của cả hai (if lồng).
- **Đích có stage `real_action` bị chặn** (`IF_INVALID` ở `then_step`/`else_step`), kể cả `else_step` ngầm = bước kế: bước trước có hiệu lực của đích là bước If (auto) nên cổng hành động thật luôn hỏng (`fnr-fix-if`, `CT/process-if.ts` `targetOk`, `HP/domain/if/if.rules.ts`). Parity contract ↔ domain: `defs/if-def-parity.test.ts`.
- Ô sai đầu tiên của cond báo path `stages.<i>.executor.when.conds.<j>.{from|op|value}`; chuỗi không dùng `lt le gt ge`.
- Run chạy theo snapshot cũ có `after.branch` ⇒ rẽ nhánh như trước (mục 5).

## 4. Node set và flow mẫu (`fnr-showcase`, `fnr-fix-set`)
Node `set` (họ work, không AI/agent) ghi field từ input run hoặc hằng: `executor.values[≤20] = {key, from: {input} | {const}}` (`CT/process-set.ts`, `HP/domain/set/set.rules.ts`, `HP/nodes/set/*`).
- Luật lưu `SET_INVALID`: `key` phải có trong `output.fields` và không trùng; `input` phải có trong def; kiểu khớp (`number`/`date`/`string`; input `text|select` ⇒ string; `file`/`source_ref` không dùng được). Input vắng lúc chạy ⇒ bỏ dòng, không lỗi.
- Chạy đồng bộ trong tx khoá run: ghi output `.md` (khối ```` ```fields ````) rồi đi đường hậu-output như agent/tool: `after: auto` ⇒ done + join; `after: review` ⇒ `waiting_review` + task duyệt (cổng, nhắc, chuyển cấp) (fix `fnr-fix-set`).
- Flow mẫu key `flow-showcase` (seed `tools/scripts/src/seed-flow-showcase.ts`, chạy tay `--apply`, prod cần `--i-know-prod`). Chạy thử 150.000.000 + "mua sắm" ⇒ hai bước duyệt song song ⇒ dừng "Giám đốc duyệt"; 50.000.000 ⇒ nhánh else "Hoàn tất". Flow mẫu không cần AI nên chạy hết kể cả khi dịch vụ AI tạm ngưng.

## 5. Rẽ nhánh `after.branch` (cũ, còn dùng)
- Stage work có thể có `after.branch[]` = luật `{field, op, value, goto_step}`; khi stage `done`, **luật đầu tiên khớp** (theo thứ tự mảng) ⇒ nhảy tới `goto_step`; không khớp / field vắng ⇒ bước kế (`evaluateBranch`, `HP/domain/branch/branch.rules.ts`).
- Giữ để tương thích def/snapshot cũ; node If là cách mới, cùng đường `settleStep` + `skippedStages`. Tham chiếu field của luật nhánh cũng được tính trong luật đổi node (mục 6, `via: "branch"`).

## 6. Đổi loại node (`fnr-swap`, **`fnr-fix-swap` thắng**)
Quyết định người dùng 2026-10-29: editor cho đổi **chéo họ**; chỉ chặn khi field mà def còn dùng sẽ mất. (Thay cho kịch bản "chỉ cùng họ" của `fnr-swap`.)
- `canSwap(def, idx, newKind, {skipFamily})` (`CT/node-swap.ts`): editor gọi với `skipFamily: true` (`AW/lib/swap-guard.ts`) ⇒ chỉ còn lỗi `field_ref` (`detail = <stage>.<via>:<field>`). Mặc định (không `skipFamily`) vẫn trả `reason: "family"` nếu khác họ.
- `field_ref` khi: loại mới `produces: none` mà còn tham chiếu tới stage đó, hoặc field được tham chiếu không còn nằm trong `output.fields`. Nơi dùng (`FieldRef.via`): `branch` (luật rẽ của chính stage), `wait_from` (`wait_until.from`), `tool_arg` (đối số tool), `cond` (cond node If).
- Stage mới chưa lưu / chưa chọn loại: chọn được mọi loại (`swapCheck` trả ok). Server vẫn kiểm lại khi lưu bằng luật def.
- Trang showcase có ô "Đổi node" (`AW/components/showcase/NodeSwapBox.tsx`): chỉ minh hoạ, không lưu, **dùng `canSwap` không `skipFamily`** nên còn hiện lý do "khác họ" — khác editor thật.
- Run đang chạy giữ snapshot cũ khi def bị đổi node.

## 7. Canvas và editor (`fnr-canvas`, `fnr-editor-drawer`)
Editor admin-web (`AW/pages/ProcessEditorPage.tsx`), view Canvas (mặc định cửa sổ ≥ 768 px; hẹp hơn mặc định dạng danh sách). Bố cục thuần: `AW/lib/canvas-layout.ts`.
- **Cột = bước**, `x` luôn suy từ bước; mỗi cột ≤ 3 node. Tiêu đề cột, node join, cạnh forward/back/branch. Cạnh nhánh If: **Đúng nét liền, Sai nét đứt**, đều có nhãn chữ.
- **Kéo dọc tự do**: vị trí lưu cùng nút "Lưu" trong trường chỉ-UI `stage.ui.y` (px, −5000…20000, `CT/process-ui.ts`; engine và luật def bỏ qua; vắng ⇒ bố cục tự động). Thả sang cột khác ⇒ đổi bước theo luật cũ (cột đầy 3 thì trượt về).
- **Sắp xếp**: xoá mọi `ui.y` đã lưu và xếp theo làn — stage chỉ chạy qua nhánh Đúng của If nằm làn trên, nhánh Sai đi thẳng làn chính, hai nhánh nhập lại ở bước chung.
- **Ngăn chi tiết (drawer)**: canvas chiếm toàn bề rộng thẻ Giai đoạn; chi tiết stage là ngăn phải **đè** lên canvas (không modal, canvas vẫn thao tác). **Mặc định đóng** khi tải trang; chọn node ⇒ mở; đóng bằng nút X hoặc Esc ⇒ bỏ chọn, canvas giữ khung nhìn (`AW/components/canvas/StagePanel.tsx`, `use-workbench.ts`).
- Chọn khung nhìn quanh drawer: `ProcessCanvas.tsx` (`fitBesideDrawer`).

## 8. Chế độ route `HUB_PROCESS_ROUTES` (`fnr-unfreeze`, `fnr-fix-unfreeze`)
`HP/routes-mode.ts` (`resolveProcessRoutes`); biến `HUB_PROCESS_ROUTES` đặt rõ thì thắng, vắng ⇒ theo cờ đóng băng (`HUB_FROZEN_MODULES` vắng/on ⇒ `all`, off ⇒ `off`). Engine + vòng nền cần `HUB_PROCESS_ENGINE=on` (tắt ⇒ không route quy trình nào mount).

| Chế độ | Route mount |
|---|---|
| `off` | không có route công khai (404) |
| `admin` | `/process-defs*`, `/agent-teams`, `/process-editor/context`, `/processes`, `/process-runs*` (usage/cancel/decide), `/review-tasks/:id/decision`; chỉ `tenant_admin`/`platform_admin` (role JWT), member ⇒ 403 `FORBIDDEN` |
| `all` | như trước CR-103 (kể cả hộp việc chat-web) |

- Ở `admin`, `GET /me/process-inbox`, `GET /me/review-tasks`, `POST /review-tasks/:id/answer` ⇒ **404** (chat-web vẫn đóng băng). `GET /process-defs` trả header `X-Process-Routes: admin`.
- **Giới hạn ở `admin`:** (a) người duyệt phải là admin **thuộc Group duyệt** (tenant_admin không thuộc Group gọi `decision` ⇒ 404); (b) stage có "Người trả lời" — câu hỏi AI không ai trả lời được ⇒ lượt chạy chờ; editor cảnh báo trên stage "Duyệt bởi Group" và stage có answerer (`AW/domain/admin-mode.rules.ts`, `StageAdminModeNotice.tsx`); (c) phần chọn nguồn (`/admin/sources*`) 404 ở chế độ này. Muốn member duyệt/trả lời cần `all` + build chat-web bật cờ.
- admin-web hiện mục "Quy trình" khi Hub trả 200 cho `GET /process-defs`, không phụ thuộc cờ build `PUBLIC_FROZEN_MODULES`. Trang `/processes/showcase` bọc `ProcessRouteGate`, không gọi API nguồn/hộp thư.
- Production (sohoptac2): `.env` có `HUB_PROCESS_ROUTES=admin`; chat-web vẫn đóng băng.

## 9. Catalog tool của stage `tool` (`fix-pd2-e05`)
Combobox "Gọi tool" chỉ gồm tool workflow **bật cho đúng công ty** và tool của gói công ty đã bật; tool lõi chỉ đọc dành cho chat (`open`: app-guide, my-activity, my-chat-history…) **không** nằm trong catalog (vẫn dùng cho chat/MCP). Công ty chưa bật tool nào ⇒ danh sách rỗng + thông báo "Chưa có tool nào được bật cho công ty". Mã: `HP/adapters/tools/tool-switch.repo.ts` (`PackToolInfo.open`).

## 9b. Lượt chạy thử (CR-105)

### Yêu cầu: Lượt chạy thử tách khỏi lượt thật
Lượt mở từ trang "Mẫu · chạy thử" (showcase, chạy mẫu) có `is_test = true`; danh sách lượt mặc định chỉ lượt thật.
- Kịch bản: khi chạy thử một mẫu thì lượt có `is_test` và không hiện trong danh sách lượt mặc định [test: apps/hub-api/src/modules/processes/runs/run-is-test.int.test.ts » lượt chạy thử đánh dấu is_test, ẩn khỏi danh sách mặc định]

## 10. Giới hạn đã biết
- Engine chưa là đồ thị đầy đủ: chỉ bước tuần tự, ≤ 3 stage song song/bước, nhảy tiến (If/`after.branch` đích > bước nguồn), không vòng lặp (CR sau).
- If chỉ so với field stage ở bước trước/input run; không có biểu thức/tính toán; ≤ 6 cond; không đích `real_action`.
- `set` chỉ nhận input `text|select|number|date` hoặc hằng; không `file`/`source_ref`.
- Chế độ `admin`: xem mục 8 (duyệt/hỏi lại hạn chế).
- `GET /process-runs/<không-phải-uuid>` trả 500 thay vì 404 (nợ ghi ở `fnr-unfreeze`; chỉ admin gặp).
- Ô "Đổi node" ở showcase hiển thị luật cùng họ, lệch với editor (mục 6).

## Chưa rõ
- Nợ `process-runs/<không-phải-uuid>` ⇒ 500: chưa kiểm đã sửa trong lát nào sau `fnr-unfreeze` hay chưa.
- Ô "Đổi node" showcase có nên hiện theo luật editor (chỉ `field_ref`) — chưa có quyết định; hiện còn mô tả khác họ.
- `fnr-fix-unfreeze` ghi tenant_admin ngoài Group duyệt gọi `decision` ⇒ 404, `fnr-unfreeze` ghi quyền quyết task "không đổi": chưa đối chiếu code `gates/` từng dòng.
- Chưa kiểm production ngoài smoke 2026-10-29 (150tr ⇒ dừng "Giám đốc duyệt"; member `/process-defs` 403, `/me/process-inbox` 404).
- `fix-pd2-e05`: danh sách đầy đủ tool lõi bị loại chỉ biết theo cờ `open` (không liệt kê tên từ code).

## CR-118 · Delta gộp 2026-11-04 (đợt cr118-r1)
Mục dưới đây thắng nội dung cũ cùng chủ đề ở trên (lát: cr118-r1-fixes, cr118-flow-admin, cr118-form-node).

#### Yêu cầu: Trần tiền của form an toàn số nguyên (nguồn: cr118-r1-fixes)
`FORM_MONEY_MAX` = 1e15 (≤ `Number.MAX_SAFE_INTEGER`).
- Kịch bản: khi trường money có max > 1e15 thì schema từ chối [test: packages/contracts/src/hub-admin/process-form-money.test.ts » FORM_MONEY_MAX an toàn số nguyên]

#### Yêu cầu: Một định nghĩa trường form cho Hub, flow và editor (nguồn: cr118-flow-admin)
Trường của node `form` có MỘT định nghĩa (8 loại: text, textarea, number, money, date, select, checkbox, file_ref; ≤ 20 trường;
nhãn/gợi ý văn bản thuần). Def của quy trình (executor `form`) và form trong view flow dùng đúng schema này; validator giá trị dựng
từ form của snapshot giống luật Hub (money nguyên ≥ 0, file_ref là uuid, checkbox bắt buộc phải đánh dấu).
- Kịch bản: khi hai nơi dùng cùng danh sách trường thì cùng chấp nhận/từ chối, kể cả khoá trùng và nhỏ nhất > lớn nhất [test: packages/contracts/src/flow/flow.test.ts » MỘT schema trường: flow dùng đúng FormFieldSchema của hub-admin (8 loại, money + file_ref)]
- Kịch bản: khi kiểm giá trị theo form snapshot thì money sai/uuid sai/trường lạ bị từ chối [test: packages/contracts/src/flow/flow.test.ts » validator từ form snapshot: strict, giới hạn, bắt buộc]

#### Yêu cầu: Editor trường của bước form và đồng bộ kết quả (nguồn: cr118-flow-admin)
Editor quy trình (Canvas và Danh sách) cho thêm/xoá/đổi chỗ trường, chọn loại, nhãn, mã, gợi ý, bắt buộc, giới hạn và lựa chọn của
select. `output.fields` của bước luôn được dựng lại từ trường form (key + kiểu) nên bước "Nếu"/bước sau đọc được và Hub không từ chối
FORM_INVALID. Bước form luôn chờ người điền (Duyệt bởi Group), không Hành động thật. Lỗi nhập hiện ngay bằng tiếng Việt.
- Kịch bản: khi thêm/xoá/đổi loại/đổi chỗ trường thì output.fields khớp trường form [test: apps/admin-web/src/features/processes/lib/form-fields.test.ts » output.fields khớp trường form (key + kiểu) sau khi thêm / xoá / đổi loại / đổi chỗ]
- Kịch bản: khi nạp def có đủ 8 loại rồi gửi lại thì không mất gì [test: apps/admin-web/src/features/processes/lib/form-fields.test.ts » 8 loại trường đi vòng def → draft → input không mất gì]
- Kịch bản: khi nhãn/mã/giới hạn/lựa chọn sai thì có câu lỗi tiếng Việt theo ô [test: apps/admin-web/src/features/processes/lib/form-fields.test.ts » giới hạn: độ dài, số, tiền, min > max]
- Kịch bản: khi tạo bước form ở Canvas rồi Lưu và Bật thì Hub lưu trường và output.fields khớp, tải lại còn [test: e2e/fnr-showcase/form-editor.fnr.ts » Canvas: thêm bước form + trường ⇒ Lưu 200 ⇒ Bật ⇒ tải lại còn, output.fields khớp trường]
- Kịch bản: khi sửa trường ở view Danh sách thì Lưu 200 và output.fields đồng bộ [test: e2e/fnr-showcase/form-editor.fnr.ts » Danh sách: sửa trường của bước form có sẵn ⇒ output.fields đồng bộ ⇒ Lưu 200]

#### Yêu cầu: Node form — người điền form ở một bước (nguồn: cr118-form-node)
Loại node `form` (họ work, produces = các trường form) chờ một thành viên Group của bước (luật như cổng kiểm) gửi giá trị
cho tập trường cố định (≤ 20; text, textarea, number, money, date, select, checkbox, file_ref; không HTML/biểu thức). Hub kiểm
theo form trong snapshot run, bỏ trường lạ, ghi field vào output stage và Đạt trong cùng transaction; If/bước sau đọc được.
- Kịch bản: khi giá trị vượt giới hạn/ sai loại/ thiếu bắt buộc thì từ chối theo key trường [test: apps/hub-api/src/modules/processes/domain/form/form.rules.test.ts » giới hạn từng loại]
- Kịch bản: khi người gửi ngoài Group, khác tenant hoặc là đối tác ở run gói contracts thì 404, thành viên Group thì 200 [test: tests/acceptance/CR118/form-node.int.test.ts » ma trận người làm: member ngoài Group / tenant khác / đối tác (run gói contracts) ⇒ 404, thành viên Group ⇒ 200]
- Kịch bản: khi giá trị sai thì 422 FORM_VALUES_INVALID và task vẫn mở [test: tests/acceptance/CR118/form-node.int.test.ts » giá trị sai ⇒ 422 FORM_VALUES_INVALID {paths}, task vẫn mở, output không đổi]
- Kịch bản: khi gửi hai lần cùng giá trị thì một kết quả, một audit, giá trị khác sau khi đóng thì 409 [test: tests/acceptance/CR118/form-node.int.test.ts » idempotent: gửi 2 lần cùng giá trị ⇒ 200 cả hai, một output, một audit, giá trị khác sau khi đóng ⇒ 409]
- Kịch bản: khi bước sau là If trên field form thì rẽ theo giá trị đã gửi [test: tests/acceptance/CR118/form-node.int.test.ts » If bước sau đọc field form: so_tien > 100 ⇒ nhảy bước 3 (bước 2 skipped), run done]
- Kịch bản: khi def đổi trường sau khi run bắt đầu thì run cũ vẫn kiểm theo snapshot [test: tests/acceptance/CR118/form-node.int.test.ts » snapshot: def sửa sau khi run bắt đầu (đổi trường) ⇒ run cũ vẫn kiểm theo form lúc bắt đầu]

#### Yêu cầu: Node Nếu đọc dữ kiện bản ghi
Điều kiện Nếu có nguồn `fact` đọc giá trị HIỆN TẠI qua `FactsReader` của app; trống ⇒ Sai; lần rẽ ghi giá trị đã đọc.
- Kịch bản: giá trị 150 > 100 ⇒ Đúng, audit ghi giá trị đã đọc [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » Nếu đọc giá trị hiện tại (150 > 100 ⇒ Đúng), ghi giá trị đã đọc vào lịch sử, Sai-nhánh skipped]
- Kịch bản: trường trống ⇒ nhánh Sai [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » trường trống ⇒ nhánh Sai, lịch sử ghi null]

#### Yêu cầu: Bước gộp next_step
Cuối nhánh có `next_step` ⇒ đi tới bước gộp, nhánh kia bị bỏ qua.
- Kịch bản: nhánh Đúng gộp về bước 5 [test: apps/hub-api/src/modules/processes/application/runs/settle-step-flow.usecase.test.ts » cuối nhánh Đúng (next_step 5) ⇒ nhảy tới bước gộp, nhánh kia skipped + huỷ hẹn]

#### Yêu cầu: Node Kết thúc gọi OutcomeHandler
Bước có `outcome` xong ⇒ app áp kết quả cùng tx chốt lượt, idempotent; giá trị đổi sau khi rẽ ⇒ "Cần xử lý".
- Kịch bản: Kết thúc idempotent khi gọi lại [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » Kết thúc ⇒ OutcomeHandler cùng tx, run done, nhánh sau skipped, gọi lại ⇒ already_applied, không đổi]
- Kịch bản: handler lỗi ⇒ rollback [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » handler ném ⇒ rollback: run KHÔNG done (thử lại sau)]
- Kịch bản: dữ kiện đổi ⇒ Cần xử lý [test: apps/hub-api/src/modules/processes/adapters/runs/flow-step.repo.int.test.ts » H2 · giá trị đổi sau khi rẽ (150 ⇒ 50) ⇒ Cần xử lý, không gọi handler]

#### Yêu cầu: Node Duyệt độc lập
Người/Group của bước Duyệt / Từ chối / Trả lại; Từ chối, Trả lại rẽ tới bước đích (Kết thúc · Từ chối / Trả lại).
- Kịch bản: Duyệt ⇒ bước kế [test: apps/hub-api/src/modules/processes/adapters/runs/flow-approve.int.test.ts » Duyệt ⇒ bước kế (Kết thúc · Đã duyệt)]
- Kịch bản: Từ chối ⇒ bước đích [test: apps/hub-api/src/modules/processes/adapters/runs/flow-approve.int.test.ts » Từ chối ⇒ reject_step (bước 2 skipped)]
- Kịch bản: Trả lại ⇒ bước đích [test: apps/hub-api/src/modules/processes/adapters/runs/flow-approve.int.test.ts » Trả lại ⇒ return_step]
- Kịch bản: không đích ⇒ cổng cũ [test: apps/hub-api/src/modules/processes/gates/approve-out.test.ts » không đích ⇒ giữ hành vi cổng cũ, stage khác ⇒ null]

#### Yêu cầu: Lượt đã kết thúc không bị chốt lại
- Kịch bản: lượt huỷ, kết quả tới muộn ⇒ vẫn huỷ [test: apps/hub-api/src/modules/processes/adapters/runs/flow-approve.int.test.ts » lượt đã huỷ, kết quả tới muộn ⇒ vẫn cancelled, handler không bị gọi]

#### Yêu cầu: Chạy lại từ Nếu
- Kịch bản: chỉ lượt "dữ kiện đổi", bấm 2 lần ra 1 kết quả [test: apps/hub-api/src/modules/processes/gates/approve-out.test.ts » bấm lần 2 (đã running, decision null) / lý do khác / không phải Nếu ⇒ null]

#### Yêu cầu: Kiểm vế dữ kiện khi lưu
- Kịch bản: khoá lạ / sai kiểu bị chặn [test: apps/hub-api/src/modules/processes/gates/approve-out.test.ts » khoá lạ / sai kiểu ⇒ FLOW_WHEN_INVALID đúng đường dẫn]

#### Yêu cầu: Chờ sự kiện nhiều kết quả (Ký số trong flow)
Node Chờ sự kiện nhận nhiều khoá, ghi khoá đã nhận vào field `event`, rẽ bước theo `branches`.
- Kịch bản: từ chối ký ⇒ rẽ nhánh Từ chối [test: apps/hub-api/src/modules/processes/adapters/timers/wait-event-esign.int.test.ts » từ chối ký ⇒ stage chờ xong (event = esign.declined), rẽ tới Kết thúc · Từ chối, nhánh Đã ký skipped]
- Kịch bản: webhook hai lần ⇒ một kết quả [test: apps/hub-api/src/modules/processes/adapters/timers/wait-event-esign.int.test.ts » webhook trả về hai lần ⇒ một kết quả (lần 2 không thả, không thêm output)]
- Kịch bản: trạng thái phong bì ⇒ khoá sự kiện [test: apps/hub-api/src/modules/processes/domain/timers/wait-event-branch.rules.test.ts » trạng thái cuối ⇒ khoá sự kiện, còn lại ⇒ null]

#### Yêu cầu: Luật lưu rẽ nhánh của Chờ sự kiện
- Kịch bản: on lạ / đích sai bị chặn [test: apps/hub-api/src/modules/processes/nodes/wait-for/wait-branches.rules.test.ts » on lạ / đích lùi / đích không có ⇒ WAIT_INVALID đúng đường dẫn]

#### Yêu cầu: Chờ sự kiện có field `event` (kể cả def `wait_event` cũ khi lưu lại / chạy: output có `fields.event`)
- Kịch bản: normalize khai field [test: apps/hub-api/src/modules/processes/nodes/wait-for/wait-branches.rules.test.ts » normalize khai field output `event`]

#### Yêu cầu: Sự kiện trùng không sót
- Kịch bản: hai sự kiện cùng chờ ⇒ dùng hết [test: apps/hub-api/src/modules/processes/adapters/timers/wait-event-esign.int.test.ts » hai sự kiện cùng chờ (webhook + đồng bộ) ⇒ thắng cái nhận sớm, MỌI dòng cùng khoá đã dùng (không sót cho bước chờ sau)]

#### Yêu cầu: Kết thúc huỷ hẹn còn mở
- Kịch bản: Từ chối rẽ tới Kết thúc [test: apps/hub-api/src/modules/processes/adapters/runs/flow-approve.int.test.ts » Từ chối rẽ tới Kết thúc khi hẹn còn mở ⇒ hẹn của nhánh bị bỏ và nhánh sau Kết thúc bị huỷ]

#### Yêu cầu: OutcomeHandler nhận người duyệt (từ E3)
`actorId` truyền cho MỌI `OutcomeHandler` = `fields.decided_by` của node Duyệt xong gần nhất (không có ⇒ null).
- Kịch bản: thủ công — đã có trong E3 [test: thủ công — đọc trong `flow-step.repo.ts` applyOutcome, int E3 `flow-*` xanh]

#### Yêu cầu: Ghi giá trị từ bước trước / dữ kiện
- Kịch bản: map field bước trước + dữ kiện, sai dạng ⇒ null + audit [test: apps/hub-api/src/modules/processes/adapters/runs/set-sources.repo.int.test.ts » field bước trước + dữ kiện ⇒ amount = 150000000, kind, sai dạng ⇒ null + 1 dòng audit]
- Kịch bản: chỉ input/hằng không thêm câu SQL [test: apps/hub-api/src/modules/processes/adapters/runs/set-sources.repo.int.test.ts » chỉ input/hằng ⇒ 0 câu SQL thêm]
- Kịch bản: biến đổi kiểu [test: apps/hub-api/src/modules/processes/domain/set/set-from.rules.test.ts » number / text / date / bool, sai dạng ⇒ undefined]
- Kịch bản: luật lưu nguồn field [test: apps/hub-api/src/modules/processes/domain/set/set-from.rules.test.ts » bước không đứng trước / khoá không có / kiểu sai ⇒ SET_INVALID ở from]

#### Yêu cầu: Gợi ý cầu nối dùng được dữ kiện bản ghi
- Kịch bản: prompt có khoá + kiểu dữ kiện của sự kiện [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » CR-122 E4b · flow của app có trigger ⇒ prompt có facts (chỉ khoá + kiểu) của sự kiện, AI dùng được nguồn fact]

#### Yêu cầu: Dữ liệu bản ghi tự nối
- Kịch bản: flow G1 không còn báo thiếu contract_id [test: packages/contracts/src/app-manifest/start-outputs.test.ts » flow G1 có app + trigger ⇒ 0 issue (Ký số tự nhận contract_id qua mọi bước)]
- Kịch bản: issue có tên bước + nhãn trường [test: packages/contracts/src/app-manifest/start-outputs.test.ts » không có trigger ⇒ vẫn báo thiếu, kèm tên bước + nhãn trường]
- Kịch bản: Ký số nhận contract_id thật không cần Ghi giá trị [test: apps/hub-api/src/modules/processes/adapters/tools/tool-auto-args.int.test.ts » contract.submitted ⇒ Ký số nhận đúng contract_id thật (không cần node Ghi giá trị)]
- Kịch bản: nguồn khai rõ thắng [test: apps/hub-api/src/modules/processes/adapters/tools/tool-auto-args.int.test.ts » nguồn khai rõ thắng (args có contract_id ⇒ không ghi đè)]
- Kịch bản: cầu nối không gọi AI khi đã khớp [test: apps/hub-api/src/modules/processes/bridge/bridge.routes.test.ts » CR-122 · A · flow của app có trigger ⇒ cạnh vào Ký số đã khớp (contract_id từ Bắt đầu khi), không gọi AI]

## CR-124/125 · Delta gộp 2026-11-08 (đợt cr124-cr125)

#### Yêu cầu: Hành động thật cần người duyệt ngay trước do node khai báo (nguồn: cr125-m5-base)
Điều kiện «bước hành động thật phải có bước duyệt ngay trước» không cố định trong code mà do node khai báo (`requires.before = approval` trong khai báo module); picker, kéo thả, nối lại và kiểm khi lưu cùng đọc khai báo đó. Ký số khai điều kiện này nên giữ nguyên hành vi; node không khai thì không bị đòi; stage không thuộc node nào giữ mặc định đòi người duyệt.
- Kịch bản: khi thêm hoặc kéo Ký số sau một bước tự động thì bị từ chối, sau bước duyệt thì được [test: packages/contracts/src/hub-admin/process-real-rule.test.ts » Ký số khai requires.before = approval, hành vi như cũ qua khoá node]
- Kịch bản: khi lưu quy trình có Ký số sau bước tự động thì báo REAL_ACTION, còn node không khai điều kiện thì không báo [test: packages/contracts/src/hub-admin/process-real-rule.test.ts » lưu (REAL_ACTION của Hub) đọc cùng khai báo: Ký số sau bước tự động ⇒ lỗi, node không đòi ⇒ không lỗi]
- Kịch bản: khi node có khai báo mà không có điều kiện thì được bật hành động thật ở mọi bước [test: packages/contracts/src/hub-admin/process-real-rule.test.ts » node có khai báo mà không có requires ⇒ không đòi gì (kể cả bước 0)]
- Kịch bản: khi stage không có node hoặc node lạ thì vẫn đòi người duyệt ngay trước [test: packages/contracts/src/hub-admin/process-real-rule.test.ts » stage không node / node lạ giữ mặc định cũ (đòi người duyệt)]
- Kịch bản: khi mount gói thì bước cơ bản của lõi vào sổ module và sổ không báo lỗi [test: apps/hub-api/src/modules/packs/core/nodes/core-nodes.binding.test.ts » module core: không lỗi sổ (không thiếu, không thừa binding)]

#### Yêu cầu: Cổng vào/ra đủ cho mọi node và tự nối từ bước trước (nguồn: cr125-m8-io-ports, cr125-m9-outputs-runstate)
Mỗi node trong sổ module khai đủ đầu vào + đầu ra có nhãn nghiệp vụ vi/en; đầu ra máy chủ chưa ghi được đánh dấu chờ và không làm nguồn tự nối. Tự nối đầu vào lấy nguồn từ «Bắt đầu khi» và đầu ra các bước đứng trước; nhiều nguồn hoặc không có thì hỏi bằng câu nghiệp vụ.
- Kịch bản: Thông báo cần «Thời điểm ký», đúng một bước Ký số phía trước cấp ⇒ nối luôn; hai bước cùng cấp ⇒ hỏi chọn; không bước nào ⇒ «thêm bước Ký số trước» [test: packages/contracts/src/modules/io-ports.test.ts » tự nối từ đầu ra các bước trước]
- Kịch bản: mọi cổng của mọi node có nhãn vi/en và đầu vào bắt buộc có cách khắc phục [test: packages/contracts/src/modules/io-ports.test.ts » cổng đủ nhãn nghiệp vụ]
- Kịch bản: flow Duyệt → Ký số → Thông báo ⇒ nguồn tại Thông báo gồm kết quả duyệt, kết quả ký (một lần), không gồm cổng chờ [test: packages/contracts/src/modules/io-ports.test.ts » flowMapSources · flow thật từ sổ MODULES]

Mọi đầu ra đã khai đều được máy chủ ghi (không còn đầu ra chờ); Ký số cấp đủ bốn cổng làm nguồn tự nối cho bước sau.
- Kịch bản: không còn đầu ra pending [test: packages/contracts/src/modules/io-ports.test.ts » danh sách đầu ra CHƯA ghi (pending) — CR-125 m9: engine ghi hết ⇒ rỗng (node mới thêm pending thì ghi vào đây)]
- Kịch bản: nguồn tại Thông báo gồm đủ cổng Ký số một lần [test: packages/contracts/src/modules/io-ports.test.ts » nguồn tại Thông báo = Bắt đầu khi + Duyệt (khớp theo executor) + Ký số MỘT lần (stage chờ, đủ 4 cổng)]
- Kịch bản: binding thật khai đủ khoá [test: apps/hub-api/src/modules/packs/packs.modules-outputs.test.ts » Duyệt ghi decision/decided_by/feedback · Ký số, Gửi đối tác, Thông báo ghi đủ cổng (CR-125 m9)]

#### Yêu cầu: module:new sinh khối cổng vào/ra (nguồn: cr125-m8-io-ports)
Scaffold node mới có khối inputs (nhãn + cách khắc phục) và outputs (nhãn, đầu ra mẫu đánh dấu chờ) để hub lên ngay.
- Kịch bản: nodeSource có outputs với nhãn vi/en và pending [test: tools/scripts/src/modules-tool.rules.test.ts » module:new · cổng vào/ra (CR-125 m8)]

## CR-125 · Delta gộp 2026-11-08 (đợt cr125-docs-sync)

#### Yêu cầu: Mẫu «Quy trình mua hàng» chạy bằng phiếu và ba phần cùng duyệt (nguồn: cr125-purchase-parent)
Thư viện có mẫu cha «Quy trình mua hàng» bắt đầu bằng phiếu «Đề xuất mua hàng» rồi chạy lần lượt Phần 1, 2, 3 như quy trình con; một phần bị từ chối hoặc huỷ thì kết thúc «Không mua». Dòng 3, 6, 10 của ba phần có nhiều nhóm duyệt cùng lúc (luật tất cả). Ba phần không tự mở theo sự kiện hợp đồng.
- Kịch bản: khi seed cấu hình công ty thì mẫu cha qua templateReadiness, qua kiểm Quy trình con (không vòng, không quá sâu), dòng cùng duyệt hợp lệ và ba phần không có flow công ty [test: tools/scripts/src/seed-cr125-config.int.test.ts » «Quy trình mua hàng» (cha): readiness ready, guard Quy trình con (không vòng / sâu), cùng duyệt hợp lệ, 3 phần không gán và không bắt đầu theo sự kiện]
- Kịch bản: khi xem mẫu cha và ba phần thì dòng 3, 6, 10 là một bước cùng duyệt theo mã nhóm, số bước và Trả lại vẫn đúng [test: apps/hub-api/src/modules/processes/library/purchase-templates.test.ts » dòng 3 / 6 / 10 duyệt CÙNG LÚC (luật tất cả), nhóm theo mã]
- Kịch bản: khi nhân viên mở Tạo yêu cầu và gửi phiếu thì yêu cầu chạy qua ba phần tới Đã xong [test: thủ công — e2e/journey-approval/cr125-purchase-full.spec.ts chạy một lần ở đợt cuối]

#### Yêu cầu: Node «Quy trình con» chạy một quy trình khác như một bước (nguồn: cr125-subprocess-engine)
Bước `subprocess` mở đúng một lượt con cùng công ty khi tới lượt, chờ lượt con kết thúc rồi đi theo kết quả; output bước có `outcome` và
dữ liệu cuối của lượt con dưới khoá `sub_<trường>`.
- Kịch bản: khi lượt con xong bình thường thì bước cha đi đầu ra `done` với `sub_*`, lượt cha chạy tiếp tới Kết thúc [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » mở MỘT lượt con ⇒ con xong ⇒ cha đi tiếp `done` với dữ liệu `sub_*`, lượt cha xong]
- Kịch bản: khi lượt con kết thúc Từ chối thì bước cha rẽ đầu ra `rejected` [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » con kết thúc Từ chối ⇒ cha rẽ đầu ra `rejected` (bước 2)]
- Kịch bản: khi kick lại hoặc stage về hàng đợi cùng lần chạy thì không mở lượt con thứ hai [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » kick lại / stage về hàng đợi cùng lần chạy ⇒ không mở lượt con thứ hai]
- Kịch bản: khi người dùng dừng lượt cha thì lượt con còn chạy bị huỷ [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » huỷ lượt cha ⇒ lượt con còn chạy bị huỷ, không hẹn mở nào cho cha]
- Kịch bản: khi lượt con lỗi thì bước cha «Cần xử lý» như tool lỗi [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » lượt con lỗi ⇒ bước cha «Cần xử lý» (tool_failed)]
- Kịch bản: khi huỷ cha đồng thời lượt con kết thúc thì không lỗi, không chờ khoá, trạng thái nhất quán [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » huỷ cha ĐỒNG THỜI lượt con kết thúc (hai thứ tự khoá) ⇒ không lỗi, không chờ khoá, trạng thái nhất quán]
- Kịch bản: khi lượt cha hết hạn thì lượt con bị huỷ [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » lượt cha hết hạn ⇒ lượt con còn chạy bị huỷ]
- Kịch bản: khi lượt con không còn thì cha đi đầu ra cancelled [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » lượt con không còn (bị xoá / gỡ liên kết) ⇒ hẹn canh chốt cha đầu ra `cancelled` + reason]
- Kịch bản: khi hẹn canh tới lúc con còn chạy thì chờ tiếp và chỉ chốt một lần [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » hẹn canh tới khi con còn chạy ⇒ ghi hẹn canh kế, con xong ⇒ chốt MỘT lần (hẹn thừa bị bỏ)]
#### Yêu cầu: Lưu quy trình có «Quy trình con» được kiểm (nguồn: cr125-subprocess-engine)
Lưu def có bước `subprocess` trỏ quy trình không có / chưa xuất bản ⇒ 422 `SUBPROCESS_NOT_FOUND`; gọi vòng ⇒ `SUBPROCESS_CYCLE`; lồng quá 3 ⇒
`SUBPROCESS_DEPTH`.
- Kịch bản: khi trỏ quy trình không có thì bị chặn [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » quy trình không có ⇒ SUBPROCESS_NOT_FOUND, có ⇒ ok]
- Kịch bản: khi A gọi B mà B gọi A thì bị chặn [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » gọi vòng A → B → A ⇒ SUBPROCESS_CYCLE (kể cả tự gọi chính mình)]
- Kịch bản: khi lồng quá 3 tầng thì bị chặn [test: apps/hub-api/src/modules/processes/nodes/subprocess/subprocess.int.test.ts » lồng quá 3 tầng ⇒ SUBPROCESS_DEPTH, đúng 3 ⇒ ok]

