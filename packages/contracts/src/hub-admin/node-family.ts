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
  set: "work",
  wait_until: "wait",
  apply: "apply",
  if: "control",
  form: "work", // CR-118 · người điền form
  wait_for: "wait", // CR-120 · G3
  wait_event: "wait", // CR-120 · G4
  notify: "work", // CR-121 D-6 · gửi thông báo, xong ngay
  approve: "work", // CR-122 E2b · node Duyệt độc lập (người quyết qua cổng kiểm)
  subprocess: "control", // CR-125 · Quy trình con: một ô nhiều đầu ra (done / rejected / cancelled), chờ lượt con
};

/** CR-103 · R3: loại node có khai báo field output cho bước sau dùng không ("none" ⇒ không được có tham chiếu tới nó). */
export type NodeProduces = "declared" | "none";
export const NODE_PRODUCES: Readonly<Record<ExecutorKind, NodeProduces>> = {
  agent: "declared",
  team: "declared",
  tool: "declared",
  set: "declared",
  wait_until: "none",
  apply: "none",
  if: "none",
  form: "declared", // CR-118 · output.fields dựng từ trường form
  wait_for: "none",
  wait_event: "declared", // CR-122 E3b · field `event` (khoá đã nhận / timeout)
  notify: "none",
  approve: "declared", // CR-122 E2b · field `decision` (approved/rejected/returned)
  subprocess: "declared", // CR-125 · field `outcome` + `sub_<trường>` của lượt con
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
