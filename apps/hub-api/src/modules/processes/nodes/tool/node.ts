// CR-103 · R1 · node `tool` (P-d2): Hub gọi tool (workflow catalog), không agent. Phần thuần: REF_INVALID (TT-R05),
// luật D2-14 (`toolStageIssues`), ép trường khi lưu (A3). Chuyển nguyên văn từ `defs/def.rules.ts`.
import {
  HANDOFF_SECTION,
  NODE_FAMILY_OF,
  type ProcessDefInput,
  resolveSteps,
} from "@ai/contracts/hub-admin";
import type { DefRefs } from "../../defs/def.rules";
import { type ToolStageShape, toolStageIssues } from "../../domain/defs/tool-def.rules";
import type { ArgSource } from "../../domain/tools/tool-run.rules";
import type { DefIssue, DefStage, NodeSpec } from "../types";

/** Mapper contract → domain (`step` đã chuẩn hoá, `stage_key` → `stageKey`). */
function toToolStage(s: DefStage, step: number): ToolStageShape {
  const ex = s.executor;
  const args: Record<string, ArgSource> = {};
  if (ex.kind === "tool")
    for (const [name, a] of Object.entries(ex.args))
      args[name] =
        a.from === "field" ? { from: "field", stageKey: a.stage_key, field: a.field } : a;
  return {
    key: s.key,
    step,
    realAction: s.real_action,
    fields: s.output.fields,
    tool: ex.kind === "tool" ? { toolKey: ex.tool_key, args } : null,
    extras: {
      sources: s.sources?.length ?? 0,
      mustKnow: s.must_know?.length ?? 0,
      autofix: (s.autofix ?? null) !== null,
      answererKind: s.answerer.kind,
    },
  };
}

/** D2-14 · `toolStageIssues` (domain) chỉ khi def có stage tool; tool vắng trong `refs.tools` để REF_INVALID xử. */
function toolIssuesOf(d: ProcessDefInput, refs: DefRefs): DefIssue[] {
  if (!d.stages.some((s) => s.executor.kind === "tool")) return [];
  const steps = resolveSteps(d.stages);
  const stages = d.stages.map((s, i) => toToolStage(s, steps[i] as number));
  const inputs = (d.inputs ?? []).map((x) => ({ key: x.key, type: x.type }));
  return toolStageIssues(stages, inputs, refs.tools ?? new Map());
}

const TOOL_RESULT_SECTION = "Kết quả";
export const TOOL_STAGE_TEMPLATE = `# {name}\n\n## ${TOOL_RESULT_SECTION}\n\n## ${HANDOFF_SECTION}\n`;

/** A3 · stage `tool`: Hub ép template/mục/answerer/token_budget/sources/must_know/autofix; giữ `fields`, `timeout_s`. */
export function ensureToolStage<S extends DefStage>(s: S): S {
  if (s.executor.kind !== "tool") return s;
  return {
    ...s,
    output: {
      ...s.output,
      template: TOOL_STAGE_TEMPLATE,
      required_sections: [TOOL_RESULT_SECTION, HANDOFF_SECTION],
    },
    answerer: { kind: "starter" },
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
  };
}

export const toolNode: NodeSpec<"tool"> = {
  kind: "tool",
  family: NODE_FAMILY_OF.tool,
  produces: "declared",
  // R-1 · D2-49 · tool `real_action` ⇒ cổng hành động thật (không agent).
  realAction: true,
  handoff: false,
  // P-d2 · TT-R05 · tool chưa bật cho tenant / workflow tắt / không tồn tại / def mẫu ⇒ cùng REF_INVALID (không lộ lý do).
  refMiss(ex, p, refs) {
    return refs.tools?.has(ex.tool_key) ? null : { path: `${p}.executor.tool_key`, ref: "tool" };
  },
  defIssues: toolIssuesOf,
  normalize: ensureToolStage,
  toolKey: (ex) => ex.tool_key,
};
