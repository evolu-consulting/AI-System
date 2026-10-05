// HUB-FR-77 · HUB-BR-03 · HUB-BR-06 · Quyền thấy/delegate agent (plan §6.1, §6.4; spec H1-R05, R06).

/** `description` tuỳ chọn để nhận cả `AgentConfig` của ảnh cấu hình lẫn hàng tối giản. */
export type AgentRow = { id: string; key: string; enabled: boolean; description?: string };
export type EntitlementRow = { agentId: string; tenantId: string; revokedAt: Date | null };
/** `subject` = uuid user hoặc group (uuid không trùng nên không cần `subject_type`). */
export type GrantRow = { agentId: string; tenantId: string; subject: string };

/** Mục trong `<agents>` của prompt Orchestrator (plan §6.2): key + mô tả; giữ `id` cho step/flow. */
export type HubAgentRef = { id: string; key: string; description: string };

export type VisibleAgentsInput = {
  agents: readonly AgentRow[];
  entitlements: readonly EntitlementRow[];
  grants: readonly GrantRow[];
  tenantId: string;
  userId: string;
  groupIds: ReadonlySet<string>;
  orchestratorId: string;
  /** H2b-R15: id agent là Orchestrator ở mọi phạm vi — loại khỏi AU. B0: chỉ kiểu (B1 áp dụng). */
  excludeIds?: ReadonlySet<string>;
  /** H2b-R09: thu hẹp theo tag. B0: chỉ kiểu (B1 áp dụng). */
  onlyKeys?: ReadonlySet<string>;
};

/** Runtime H1 (job `agent.cli`, plan §2.2). */
export const H1_RUNTIME = "agentic-cli";
/** Runtime chạy được: H1 + agent `dify-*` do Hub gọi Dify (H2a-R14, `RoutingRunner`); runtime khác chờ mốc sau. */
export const RUNNABLE_RUNTIMES: ReadonlySet<string> = new Set([
  H1_RUNTIME,
  "dify-workflow",
  "dify-agent",
]);

/** Phần của `ConfigSnapshot` cần cho quyền — kiểu cấu trúc để không import ngược `config`. */
export type AccessSnapshot = {
  agents: readonly (AgentRow & { runtime: string })[];
  entitlements: readonly EntitlementRow[];
  grants: readonly GrantRow[];
  orchestrator: { agentId: string } | null;
  /** H2b-R13: bản Orchestrator theo tenant (khoá = `tenant_id`). */
  orchestratorTenants?: ReadonlyMap<string, { agentId: string }>;
};
export type AccessSubject = { tenantId: string; userId: string; groupIds: ReadonlySet<string> };

/**
 * HUB-BR-06: quyền tính trên ảnh run giữ lúc bắt đầu, không đọc ảnh mới giữa run. Chỉ agent `RUNNABLE_RUNTIMES` vào
 * danh sách (không thấy, không delegate được): agent runtime khác không có runner chạy nổi.
 */
export function accessInput(
  s: AccessSnapshot,
  who: AccessSubject,
  _opts?: { onlyKeys?: ReadonlySet<string> },
): VisibleAgentsInput {
  return {
    agents: s.agents.filter((a) => RUNNABLE_RUNTIMES.has(a.runtime)),
    entitlements: s.entitlements,
    grants: s.grants,
    orchestratorId: s.orchestrator?.agentId ?? "",
    ...who,
  };
}

/** H2b-R15: id agent Orchestrator mặc định ∪ mọi bản tenant. B0: chỉ chữ ký (B1). */
export function orchestratorIds(_s: {
  orchestrator: { agentId: string } | null;
  orchestratorTenants?: ReadonlyMap<string, { agentId: string }>;
}): Set<string> {
  throw new Error("not implemented: orchestratorIds");
}

/** HUB-FR-77: bật ∧ entitlement chưa thu hồi của tenant ∧ grant (user ∨ group của user) ∧ ≠ Orchestrator; sắp `key`. */
export function visibleAgents(i: VisibleAgentsInput): HubAgentRef[] {
  const entitled = new Set<string>();
  for (const e of i.entitlements) {
    if (e.tenantId === i.tenantId && e.revokedAt === null) entitled.add(e.agentId);
  }
  const granted = new Set<string>();
  for (const g of i.grants) {
    if (g.tenantId === i.tenantId && (g.subject === i.userId || i.groupIds.has(g.subject))) {
      granted.add(g.agentId);
    }
  }
  return i.agents
    .filter(
      (a) => a.enabled && a.id !== i.orchestratorId && entitled.has(a.id) && granted.has(a.id),
    )
    .map((a) => ({ id: a.id, key: a.key, description: a.description ?? "" }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/**
 * HUB-BR-03 · H1-R06: kiểm lại mỗi lần Orchestrator delegate (theo `key` trong quyết định).
 * null → step `skipped` (`reason='not_allowed'`), không chạy agent.
 */
export function canDelegate(i: VisibleAgentsInput, agentKey: string): HubAgentRef | null {
  return visibleAgents(i).find((a) => a.key === agentKey) ?? null;
}
