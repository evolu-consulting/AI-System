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
