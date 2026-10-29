# Thiết kế: flow-node-registry (CR-103)

## 1. Lõi và node (modular monolith)
```
hub-api/src/modules/processes/
  core/, domain/, runs/, gates/, timers/ ...   ← LÕI: bước, join, rẽ nhánh, cổng duyệt, hẹn giờ, thử lại, view chung
  nodes/
    registry.ts                                ← Map<kind, NodeKind>; lõi chỉ gọi qua đây
    agent/  team/  tool/  wait-until/  apply/  set/ (R4)
```
Luật phụ thuộc: `nodes/*` chỉ import `core/ports` + `domain` dùng chung; lõi không import `nodes/<kind>` (chỉ `registry`).
Kiểm bằng một test import (như `frozen.rules`), không thêm thư viện.

```ts
type NodeFamily = "work" | "wait" | "apply";
interface NodeKind<E extends { kind: string }> {
  kind: E["kind"];
  family: NodeFamily;
  /** field output mà node chắc chắn cung cấp; "declared" = theo output.fields của stage. */
  produces: "declared" | "none";
  /** def.rules: tham chiếu (agent/team/tool tồn tại), luật riêng (applyStageIssues, toolStageIssues, wait). */
  validate(stage: ProcessStageDef & { executor: E }, refs: DefRefs): DefIssue[];
  /** launcher: tạo hub.runs / hẹn giờ / job; trả KickResult như hiện nay. */
  launch(d: LauncherDeps, tx: Tx, ctx: LaunchCtx<E>): Promise<KickResult>;
  /** tuỳ chọn: chốt kết quả (apply-driver, tool-stage-settle), view riêng (view-apply, view-autofix), session agent. */
  settle?: ...; view?: ...; session?: ...;
}
```
Contract giữ `z.discriminatedUnion("kind", [...])` tĩnh (zod cần biết trước) — "không dynamic" là chủ ý. Thêm loại node
= 1 schema trong union + 1 module `nodes/<kind>` + 1 editor FE. FE có registry song song
(`admin-web/.../nodes/registry.ts`: `kind, family, label, Editor, defaults()`), `stage-convert.ts` đọc từ đây.

Cách tách R1 (không đổi hành vi): chuyển nguyên văn từng nhánh `if (executor.kind === …)` vào module node tương ứng,
lõi gọi `registry.get(kind).launch(...)`. Thứ tự kiểm cũ (starterUsable → team → wait/apply/tool/agent) giữ nguyên.
Test hiện có là lưới an toàn; thêm một test "mọi kind trong contract có module trong registry" và test import.

## 2. Họ node và luật đổi node (R3)
| Họ | Loại | Ghi chú |
|---|---|---|
| work | agent, team, tool, set | sinh output (md + fields) |
| wait | wait_until | không output field |
| apply | apply | gắn sau stage tự-sửa, không đổi được |
| control | if | không output; đổi được trong họ khi có thêm loại control |

`canSwap(stage, newKind, def)`: cùng họ **và** mọi field mà def dùng từ stage này (luật rẽ nhánh của nó, `wait_until.from`
của stage sau, `ToolArg.from` của stage sau) vẫn nằm trong `output.fields` (giữ nguyên khi đổi) — với `produces: "none"`
thì không được có tham chiếu. Hàm thuần dùng chung FE/BE (đặt ở contracts), BE vẫn kiểm lại khi lưu bằng `def.rules`.

## 3. Node If (R2)
```ts
IfExecutor = { kind: "if", when: { op: "and"|"or", conds: Cond[1..6] }, then_step: number, else_step: number | null }
Cond = { from: { kind: "field", stage_key, field } | { kind: "input", key }, op: eq|ne|lt|le|gt|ge, value }
```
- Họ `control`, `produces: "none"`; một node If **đứng một mình trong bước** (không song song), `after: auto`,
  `real_action: false`, không output.template/fields (contract cho phép rỗng khi kind = `if`).
- Chạy: launcher gọi `nodes/if.launch` ⇒ đánh giá trong tx (đọc fields đã lưu của stage nguồn, input run) ⇒ chốt stage
  `done` + ghi lý do (luật nào khớp) ⇒ nhảy như rẽ nhánh hiện có: Đúng ⇒ `then_step`, Sai ⇒ `else_step ?? bước kế`;
  stage giữa bị `skipped` (join coi là xong). Dùng lại `evaluateBranch`/`skippedStages`/`effectivePrevStep`.
- Kiểm def: `then_step`/`else_step` > bước của If và < số bước; stage nguồn ở bước nhỏ hơn và có field khai báo đúng kiểu;
  op thứ tự không dùng cho string; đích có `real_action` ⇒ như PD2-R12 (bước trước đích phải có gate review).
- `after.branch` cũ giữ nguyên (không bỏ); editor mới khuyến khích node If.
- Kiểu `Cond`/`when` đặt trong contracts, gói contracts (`FlowWhen`) chuyển sang dùng sau (không bắt buộc đợt này).
- Canvas: node If hình thoi, hai cạnh "Đúng"/"Sai" tới bước đích (dùng lại `BranchEdge`).
- Lâu dài: engine đồ thị sau này giữ nguyên `IfExecutor`, chỉ đổi `then_step/else_step` thành cạnh.

## 4. Showcase (R4)
- Node `set`: `{kind:"set", values:[{key, from:{input:key}|{const:value}}]}`; chạy đồng bộ trong tx (không job, không
  AI), ghi `fields` + render `output.template`. Họ `work`.
- Flow mẫu "Duyệt đề nghị chi (mẫu)" seed bằng `tools/scripts/src/seed-flow-showcase.ts` (cờ `--apply`, chỉ tenant demo):
  Bước 1 `set` (amount, purpose từ input) → Bước 2 song song: "Pháp chế" ∥ "Kế toán" (`set` + cổng duyệt nhóm) →
  join → Bước 3 node If `amount > 100.000.000` AND `purpose = "mua sắm"` → Bước 4 "Giám đốc duyệt", Sai → Bước 5
  "Hoàn tất".
- Trang `/processes/showcase`: canvas chỉ đọc (dùng `ProcessCanvas`), form input + "Chạy thử", dòng thời gian
  (`RunProgress`/`RunLog` sẵn có, cập nhật qua stream hiện có), nút Đạt/Chưa đạt khi người xem trong nhóm duyệt, khung
  "Đổi node" gọi `canSwap` để minh hoạ (không lưu).
- Mở băng: bỏ `processes` route `/process-defs*`, `/process-runs*` khỏi `HUB_FROZEN_MODULES` chỉ khi request từ
  admin-web (X-App), chat-web giữ nguyên.
