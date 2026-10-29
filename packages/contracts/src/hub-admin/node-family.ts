// CR-103 · R1 fnr-registry · design §2: họ node (dùng chung FE/BE). Thuần, không zod — schema executor giữ nguyên ở
// `processes.ts` (`z.discriminatedUnion` tĩnh). Thêm loại node ⇒ thêm một dòng ở `NODE_FAMILY_OF` (thiếu ⇒ lỗi typecheck).
import type { ProcessStageDef } from "./processes";

export type ExecutorKind = ProcessStageDef["executor"]["kind"];
export const NODE_FAMILIES = ["work", "wait", "apply", "control"] as const;
export type NodeFamily = (typeof NODE_FAMILIES)[number];

/** work = sinh output (md + fields); wait = chờ, không field; apply = gắn sau stage tự-sửa; control = điều khiển (R2). */
export const NODE_FAMILY_OF: Readonly<Record<ExecutorKind, NodeFamily>> = {
  agent: "work",
  team: "work",
  tool: "work",
  wait_until: "wait",
  apply: "apply",
};

/** CR-103 · R3: loại node có khai báo field output cho bước sau dùng không ("none" ⇒ không được có tham chiếu tới nó). */
export type NodeProduces = "declared" | "none";
export const NODE_PRODUCES: Readonly<Record<ExecutorKind, NodeProduces>> = {
  agent: "declared",
  team: "declared",
  tool: "declared",
  wait_until: "none",
  apply: "none",
};

/** Họ của loại node; loại lạ (def cũ/hỏng) ⇒ null. */
export function nodeFamily(kind: string): NodeFamily | null {
  return Object.hasOwn(NODE_FAMILY_OF, kind) ? NODE_FAMILY_OF[kind as ExecutorKind] : null;
}

/** Có stage thuộc họ `family` (vd `apply` ⇒ cần nạp view Áp). */
export const hasNodeFamily = (
  stages: readonly { executor: { kind: string } }[],
  family: NodeFamily,
): boolean => stages.some((s) => nodeFamily(s.executor.kind) === family);
