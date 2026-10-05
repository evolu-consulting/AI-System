// HUB-FR-77 · HUB-FR-92 · HUB-BR-03 · helper test hàm thuần H2b (test-plan §2.1, cases §1.3–§1.5): agent, quyền,
// ảnh cấu hình tối thiểu. Chỉ dữ liệu, không I/O.
import type {
  AccessSubject,
  EntitlementRow,
  GrantRow,
} from "../../../../apps/hub-api/src/modules/agents/agent-access.rules";
import type {
  AgentConfig,
  ConfigSnapshot,
  OrchestratorConfig,
} from "../../../../apps/hub-api/src/modules/config/config.rules";

/** Dải uuid cố định H2b (`a2b0…`, test-plan §2.1). */
export const uid = (n: number): string => `a2b00000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const ACME = uid(1);
export const BETA = uid(2);
export const LAN = uid(11);
export const TADMIN = uid(12);
export const G1 = uid(21);

export const A = {
  orch: uid(101),
  assistant: uid(102),
  helper: uid(103),
  writer: uid(104),
  hoadon: uid(105),
  llmbot: uid(106),
  orchAcme: uid(107),
  orchBeta: uid(108),
  off: uid(109),
} as const;

export const agentCfg = (id: string, key: string, o: Partial<AgentConfig> = {}): AgentConfig => ({
  id,
  key,
  name: { vi: `Tên ${key}`, en: `Name ${key}` },
  description: `Agent ${key} dùng cho kiểm thử định tuyến.`,
  runtime: "agentic-cli",
  agentTypeKey: null,
  profileId: uid(900),
  systemPrompt: "",
  runtimeOptions: {},
  timeoutS: 600,
  tokenBudget: null,
  enabled: true,
  version: 1,
  ...o,
});

// Thứ tự cố ý không theo key để kiểm sắp xếp.
export const AGENTS: AgentConfig[] = [
  agentCfg(A.writer, "writer"),
  agentCfg(A.orch, "orchestrator"),
  agentCfg(A.assistant, "assistant", { name: { vi: "Trợ lý", en: "Assistant" } }),
  agentCfg(A.llmbot, "llmbot", { runtime: "llm" }),
  agentCfg(A.hoadon, "hoadon"),
  agentCfg(A.orchAcme, "orch-acme"),
  agentCfg(A.orchBeta, "orch-beta"),
  agentCfg(A.off, "off-agent", { enabled: false }),
  agentCfg(A.helper, "helper"),
];

const ent = (agentId: string): EntitlementRow => ({ agentId, tenantId: ACME, revokedAt: null });
export const ENTITLEMENTS: EntitlementRow[] = AGENTS.map((a) => ent(a.id));

const grant = (agentId: string, subject = LAN): GrantRow => ({ agentId, tenantId: ACME, subject });
/** `lan` có grant mọi agent trừ `hoadon` (cả Orchestrator mặc định/tenant để kiểm loại trừ). */
export const GRANTS: GrantRow[] = [
  grant(A.orch),
  grant(A.assistant),
  grant(A.helper, G1),
  grant(A.writer),
  grant(A.llmbot),
  grant(A.orchAcme),
  grant(A.orchBeta),
  grant(A.off),
];

export const orchCfg = (
  agentId: string,
  o: Partial<OrchestratorConfig> = {},
): OrchestratorConfig => ({
  agentId,
  maxSteps: 5,
  tokenBudget: 200_000,
  historyN: 10,
  onNoMatch: "answer",
  version: 1,
  ...o,
});

export const snapshot = (o: Partial<ConfigSnapshot> = {}): ConfigSnapshot => ({
  version: 1,
  providers: [],
  profiles: [],
  agents: AGENTS,
  orchestrator: orchCfg(A.orch),
  entitlements: ENTITLEMENTS,
  grants: GRANTS,
  agentWorkflows: new Map(),
  orchestratorTenants: new Map([
    [ACME, orchCfg(A.orchAcme)],
    [BETA, orchCfg(A.orchBeta)],
  ]),
  ...o,
});

export const LAN_WHO: AccessSubject = { tenantId: ACME, userId: LAN, groupIds: new Set([G1]) };
export const TADMIN_WHO: AccessSubject = { tenantId: ACME, userId: TADMIN, groupIds: new Set() };
