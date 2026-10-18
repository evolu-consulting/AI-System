# Plan · P-d2 — chữ ký luật lớp 1 (tool, rẽ nhánh)

Tách theo chủ đề từ [plan-d2.md](plan-d2.md) (trần 18 KB). qc viết test trước theo đây; path lỗi: [plan-addendum A2](plan-addendum.md). Kiểu domain tự khai (ADR-0023, lớp 1 không import `@ai/contracts`).

## 1. Chữ ký
```ts
// domain/defs/tool-def.rules.ts — path theo bảng plan-addendum A2 (nguồn duy nhất)
export type ToolDefShape = { key: string; sideEffect: boolean; params: readonly { name: string; type: string; required: boolean; options?: readonly string[] }[] };
export function toolStageIssues(stages: readonly (StageShape & { tool: { toolKey: string; args: Readonly<Record<string, ArgSource>> } | null })[],
  inputs: readonly InputShape[], tools: ReadonlyMap<string, ToolDefShape>): DefIssue[];   // tool_key ∉ tools ⇒ không issue
// domain/tools/tool-run.rules.ts
export type ArgSource = { from: "input"; key: string } | { from: "field"; stageKey: string; field: string }
  | { from: "const"; value: string | number | boolean };
export function buildToolArgs(args: Readonly<Record<string, ArgSource>>, inputs: ReadonlyMap<string, string>,
  fields: ReadonlyMap<string, Readonly<Record<string, string | number>> | null>,
  inputTypes?: ReadonlyMap<string, string>):   // input kiểu "number" ⇒ Number(value); không có ⇒ giữ chuỗi
  { ok: true; values: Record<string, string | number | boolean> } | { ok: false; missing: string };
export type ToolFailure = { code: string; httpStatus: number | null; sent: boolean; reason: "upstream" | "invalid_output" | null };
/** chưa gửi ∧ (UPSTREAM_ERROR|TIMEOUT) ⇒ transient; đã gửi: TIMEOUT | UPSTREAM_ERROR với http null/≥500/408/429 ⇒ transient;
 *  4xx khác | NOT_CONFIGURED | INVALID_ARGS | invalid_output | lạ ⇒ business. */
export function classifyToolError(f: ToolFailure): JobErrorClass;
/** business ⇒ decide(tool_failed); transient ∧ sideEffect ∧ sent ⇒ decide(tool_failed); hết lượt ⇒ decide(retry_exhausted);
 *  còn lại ⇒ retry (qua `decideRetry`, sideEffectSent = sideEffect ∧ sent). */
export function toolFailureDecision(i: { f: ToolFailure; sideEffect: boolean; state: RetryState; now: Date }): RetryDecision;
// domain/tools/tool-output.rules.ts
export function filterToolFields(result: unknown, decl: StageShape["fields"]):
  { ok: true; fields: Record<string, string | number> } | { ok: false; why: "not_object" | "missing" | "type" };
export function toolOutputMd(stageName: string, fields: Readonly<Record<string, string | number>>): string;
// = "# {name}\n\n## Kết quả\n| Trường | Giá trị |\n|---|---|\n…\n\n## Bàn giao\nĐã gọi tool; trường: {k1, k2…}\n\n```fields\n{json}\n```\n"
// domain/branch/branch-def.rules.ts
export type BranchRule = { field: string; op: "eq" | "ne" | "lt" | "le" | "gt" | "ge"; value: string | number; gotoStep: number };
export function branchStageIssues(stages: readonly (StageShape & { branch: readonly BranchRule[] })[]): DefIssue[];
// domain/branch/branch.rules.ts
export function evaluateBranch(rules: readonly BranchRule[], fields: Readonly<Record<string, string | number>> | null):
  { gotoStep: number; rule: number } | null;                       // luật đầu khớp; trường vắng ⇒ không khớp; date so YYYY-MM-DD
export function skippedStages(steps: readonly number[], fromStep: number, gotoStep: number): number[];   // idx stage bước (from, goto)
export function effectivePrevStep(stepStatuses: ReadonlyMap<number, readonly StageRunStatus[]>, step: number): number | null; // D2-08
```
Domain `StageRunStatus`/`DecisionReason`/`ExecutorKind` thêm `skipped`/`tool_failed`/`tool` ở T17 (mapper test đỏ tới khi khớp); `step.rules.stepJoin`/`runStatusOf`: `skipped` = xong.

## 2. `paramCompatible` (D2-29; ma trận duy nhất, BE `tool-def.rules.ts` và FE `domain/tool-rules.ts` cùng bảng + cùng vector test)
```ts
/** sourceType: kiểu nguồn = kiểu input/field ("string"|"number"|"date") hoặc typeof const ("string"|"number"|"boolean"). */
export function paramCompatible(sourceType: "string" | "number" | "date" | "boolean", paramType: string): boolean;
```
| paramType | nguồn hợp lệ |
|---|---|
| `number` | `number` (input/field number, const số) |
| `boolean` | `boolean` (chỉ const) |
| `select` | `string` (input/field chuỗi); const `string` còn phải ∈ `options` (kiểm ở `toolStageIssues`) |
| `text`, `paragraph` | mọi nguồn (số/ngày `String()`) |
| khác | cùng kiểu hoặc `string` |
Sai ⇒ `TOOL_INVALID` path `stages.<i>.executor.args.<name>` (lúc lưu). FE gửi const đúng kiểu tham số.

