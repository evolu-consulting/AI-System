// CR-103 · R1 fnr-registry · design §1: registry loại node (phần THUẦN). Lõi (`defs/`, `runs/`, `kh/`…) chỉ hỏi loại node qua
// đây, không so `executor.kind` và không import `nodes/<kind>/*`. Phần chạy: `registry.launch.ts`.
import type { ExecutorKind, ProcessDefInput } from "@ai/contracts/hub-admin";
import type { DefRefs, RefMiss } from "../defs/def.rules";
import { agentNode } from "./agent/node";
import { applyNode } from "./apply/node";
import { setNode } from "./set/node";
import { ifNode } from "./if/node";
import { teamNode } from "./team/node";
import { toolNode } from "./tool/node";
import type { DefIssue, DefStage, NodeSpec } from "./types";
import { waitUntilNode } from "./wait-until/node";

/** Mọi loại trong union contract PHẢI có mặt (thiếu ⇒ lỗi typecheck). */
export const NODES: { readonly [K in ExecutorKind]: NodeSpec<K> } = {
  agent: agentNode,
  team: teamNode,
  apply: applyNode,
  wait_until: waitUntilNode,
  tool: toolNode,
  set: setNode,
  if: ifNode,
};

/** Thứ tự cố định (= `EXECUTOR_KINDS`): quyết thứ tự lỗi `defIssues` (team trước tool như cũ). */
const NODE_LIST: readonly NodeSpec[] = [
  NODES.agent,
  NODES.team,
  NODES.apply,
  NODES.wait_until,
  NODES.tool,
  NODES.set,
  NODES.if,
] as NodeSpec[];

/** Loại lạ (snapshot cũ/hỏng) ⇒ undefined. */
export function nodeSpecOf(kind: string): NodeSpec | undefined {
  return Object.hasOwn(NODES, kind) ? (NODES[kind as ExecutorKind] as NodeSpec) : undefined;
}

/** agent_id khi stage chạy bằng đúng một agent; còn lại null. */
export const agentIdOf = (ex: { kind: string }): string | null =>
  nodeSpecOf(ex.kind)?.agentId?.(ex) ?? null;

/** Loại node chạy bằng đúng một agent (không cần đọc agent_id). */
export const runsAsAgent = (kind: string): boolean => nodeSpecOf(kind)?.agentId !== undefined;

/** Stage `real_action` của loại này đi qua cổng hành động thật. */
export const gatesRealAction = (kind: string): boolean => nodeSpecOf(kind)?.realAction === true;

/** REF_INVALID của executor (agent/team/tool vắng trong `refs`). */
export function executorRefMiss(
  ex: DefStage["executor"],
  path: string,
  refs: DefRefs,
): RefMiss | null {
  return nodeSpecOf(ex.kind)?.refMiss?.(ex as never, path, refs) ?? null;
}

/** Luật INVALID riêng từng loại node, nối theo `NODE_LIST`. */
export const nodeDefIssues = (d: ProcessDefInput, refs: DefRefs): DefIssue[] =>
  NODE_LIST.flatMap((n) => n.defIssues?.(d, refs) ?? []);

/** Hub ép trường theo loại node khi lưu def. */
export function normalizeStage<S extends DefStage>(s: S): S {
  return nodeSpecOf(s.executor.kind)?.normalize?.(s) ?? s;
}

/** Key tool mà def tham chiếu (nạp `DefRefs.tools`). */
export const toolKeysOf = (stages: readonly DefStage[]): string[] =>
  stages.flatMap((s) => {
    const k = nodeSpecOf(s.executor.kind)?.toolKey?.(s.executor as never);
    return k === undefined ? [] : [k];
  });
