// CR-103 · R1 fnr-registry · design §1: registry loại node phía editor (song song `hub-api/.../nodes/registry.ts`).
// `lib/stage-convert.ts` đọc từ đây thay vì so `executor.kind`. Thêm loại node = thêm một mục (thiếu ⇒ lỗi typecheck).
import {
  type ExecutorKind,
  NODE_FAMILY_OF,
  type NodeFamily,
  type ProcessStageDef,
} from "@ai/contracts/hub-admin";
import { APPLY_EXECUTOR, APPLY_PATCH, executorToDef } from "../lib/apply-form";
import type { StageDraft } from "../lib/draft-types";
import { TOOL_EXECUTOR, TOOL_PATCH, toolFromDef, toolToDef } from "../lib/tool-form";
import { WAIT_EXECUTOR, WAIT_PATCH, waitFromDef, waitToDef } from "../lib/wait-form";

type Executor = ProcessStageDef["executor"];
type Ex<K extends ExecutorKind> = Extract<Executor, { kind: K }>;

export type FeNode<K extends ExecutorKind = ExecutorKind> = {
  kind: K;
  family: NodeFamily;
  /** Khoá i18n nhãn loại; agent/team = null (nhãn là tên agent/nhóm trong danh sách chọn). */
  labelKey: string | null;
  /** Patch draft khi chọn loại này (agent/team: rỗng — chỉ đổi `executor` theo agent/nhóm được chọn). */
  defaults(): Partial<StageDraft>;
  /** Giá trị cố định của ô `executor` (loại không tham chiếu agent/nhóm); agent/team = null ("agent:<id>"/"team:<id>"). */
  draftValue: string | null;
  /** Giá trị ô `executor` của draft. */
  draftExecutor(ex: Ex<K>): string;
  /** Phần draft riêng của loại khi nạp def (vắng ⇒ giữ rỗng). */
  fromDef?(ex: Ex<K>): Partial<Pick<StageDraft, "wait" | "tool">>;
  /** Draft → executor của contract. */
  toDef(s: StageDraft): Executor;
};

const refToDef = (s: StageDraft): Executor => executorToDef(s.executor);

export const FE_NODES: { readonly [K in ExecutorKind]: FeNode<K> } = {
  agent: {
    kind: "agent",
    family: NODE_FAMILY_OF.agent,
    labelKey: null,
    defaults: () => ({}),
    draftValue: null,
    draftExecutor: (ex) => `agent:${ex.agent_id}`,
    toDef: refToDef,
  },
  team: {
    kind: "team",
    family: NODE_FAMILY_OF.team,
    labelKey: null,
    defaults: () => ({}),
    draftValue: null,
    draftExecutor: (ex) => `team:${ex.team_id}`,
    toDef: refToDef,
  },
  apply: {
    kind: "apply",
    family: NODE_FAMILY_OF.apply,
    labelKey: "process.admin.apply.kind",
    defaults: () => ({ ...APPLY_PATCH }),
    draftValue: APPLY_EXECUTOR,
    draftExecutor: () => APPLY_EXECUTOR,
    toDef: refToDef,
  },
  wait_until: {
    kind: "wait_until",
    family: NODE_FAMILY_OF.wait_until,
    labelKey: "process.admin.editor.stage.kind.wait",
    defaults: () => ({ ...WAIT_PATCH }),
    draftValue: WAIT_EXECUTOR,
    draftExecutor: () => WAIT_EXECUTOR,
    fromDef: (ex) => ({ wait: waitFromDef(ex) }),
    toDef: (s) => waitToDef(s.wait),
  },
  tool: {
    kind: "tool",
    family: NODE_FAMILY_OF.tool,
    labelKey: "process.admin.editor.stage.kind.tool",
    defaults: () => ({ ...TOOL_PATCH }),
    draftValue: TOOL_EXECUTOR,
    draftExecutor: () => TOOL_EXECUTOR,
    fromDef: (ex) => ({ tool: toolFromDef(ex) }),
    toDef: (s) => toolToDef(s.tool),
  },
};

/** Mục registry của executor contract. */
export const feNodeOf = <K extends ExecutorKind>(kind: K): FeNode<K> => FE_NODES[kind] as FeNode<K>;

/** Loại node của ô `executor` draft ("agent:<id>"/"team:<id>"/"apply"/"wait_until"/"tool"); trống/lạ ⇒ null. */
export function draftKindOf(executor: string): ExecutorKind | null {
  for (const n of Object.values(FE_NODES) as FeNode[])
    if (n.draftValue !== null && executor === n.draftValue) return n.kind;
  const head = executor.split(":")[0];
  return head === "agent" || head === "team" ? head : null;
}
