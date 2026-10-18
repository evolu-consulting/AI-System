// HUB-FR-145 · HUB-BR-43 · HUB-BR-25 · PD-R20/R22 · luật thuần chuyển cấp review_task. Không DB.
export function dueEscalation(
  t: {
    kind: "review" | "ask" | "decision";
    status: "open" | "closed";
    escalateAt: Date | null;
    escalatedAt: Date | null;
  },
  now: Date,
): boolean {
  return (
    t.kind === "review" &&
    t.status === "open" &&
    t.escalatedAt === null &&
    t.escalateAt !== null &&
    t.escalateAt.getTime() <= now.getTime()
  );
}

export type EscalateAction = { kind: "add_group"; groupId: string } | { kind: "skip" };

/** Group đích còn tồn tại ∧ cùng tenant task ⇒ add_group; ngược lại skip (audit `escalate_skipped`). */
export function escalateAction(p: {
  groupId: string;
  groupExists: boolean;
  groupTenantId: string | null;
  taskTenantId: string;
}): EscalateAction {
  return p.groupExists && p.groupTenantId !== null && p.groupTenantId === p.taskTenantId
    ? { kind: "add_group", groupId: p.groupId }
    : { kind: "skip" };
}
