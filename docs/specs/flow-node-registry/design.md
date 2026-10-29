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

`canSwap(stage, newKind, def)`: cùng họ **và** mọi field mà def dùng từ stage này (luật rẽ nhánh của nó, `wait_until.from`
của stage sau, `ToolArg.from` của stage sau) vẫn nằm trong `output.fields` (giữ nguyên khi đổi) — với `produces: "none"`
thì không được có tham chiếu. Hàm thuần dùng chung FE/BE (đặt ở contracts), BE vẫn kiểm lại khi lưu bằng `def.rules`.

## 3. Điều kiện if/else (R2)
```ts
BranchRule = { when: { op: "and"|"or", conds: Cond[1..6] }, goto_step }
Cond = { source: "field"|"input", key, op: eq|ne|lt|le|gt|ge, value }
after.branch = BranchRule[]   +   after.else_goto_step?: number
```
- Đọc snapshot cũ `{field, op, value, goto_step}` ⇒ `{when:{op:"and",conds:[{source:"field",key:field,op,value}]}}`
  (chuẩn hoá khi đọc; ghi luôn dạng mới).
- Đánh giá: luật đầu tiên khớp thắng; không luật nào khớp ⇒ `else_goto_step` nếu có, không thì bước kế (như cũ).
  Vẫn chỉ nhảy tới (`goto > step`), stage bị nhảy qua = `skipped` (join coi là xong) — không đổi.
- Kiểu `Cond` dùng chung với `FlowWhen` của gói contracts (cùng file contracts), gói chuyển sang dùng sau, không bắt buộc
  trong đợt này.

## 4. Showcase (R4)
- Node `set`: `{kind:"set", values:[{key, from:{input:key}|{const:value}}]}`; chạy đồng bộ trong tx (không job, không
  AI), ghi `fields` + render `output.template`. Họ `work`.
- Flow mẫu "Duyệt đề nghị chi (mẫu)" seed bằng `tools/scripts/src/seed-flow-showcase.ts` (cờ `--apply`, chỉ tenant demo):
  Bước 1 `set` (amount, purpose từ input) → Bước 2 song song: "Pháp chế" ∥ "Kế toán" (`set` + cổng duyệt nhóm) →
  join → if `amount > 100.000.000` AND `purpose = "mua sắm"` → Bước 3 "Giám đốc duyệt", else → Bước 4 "Hoàn tất".
- Trang `/processes/showcase`: canvas chỉ đọc (dùng `ProcessCanvas`), form input + "Chạy thử", dòng thời gian
  (`RunProgress`/`RunLog` sẵn có, cập nhật qua stream hiện có), nút Đạt/Chưa đạt khi người xem trong nhóm duyệt, khung
  "Đổi node" gọi `canSwap` để minh hoạ (không lưu).
- Mở băng: bỏ `processes` route `/process-defs*`, `/process-runs*` khỏi `HUB_FROZEN_MODULES` chỉ khi request từ
  admin-web (X-App), chat-web giữ nguyên.
