// HUB-FR-60, HUB-FR-23 · kiểu dùng chung của seed (plan H1 §3.6, H2a plan-db §4) — tách khỏi `seed.rules` để
// `seed.workflows` dùng mà không vòng import (`seed.rules` → `seed.workflows`). Chỉ kiểu.
import type {
  SeedAgent,
  SeedAgentWorkflow,
  SeedEntitlement,
  SeedGrant,
  SeedOrchestrator,
  SeedProfile,
  SeedProvider,
} from "./seed.schema";

export type SeedIssue = { path: string; message: string; value?: unknown };

export type SeedPlan = {
  providers: SeedProvider[];
  profiles: SeedProfile[];
  agents: (Omit<SeedAgent, "profile"> & { profile: string })[];
  orchestrator: SeedOrchestrator;
  entitlements: SeedEntitlement[];
  grants: SeedGrant[];
  /** H2a: key workflow Admin — đổi sang id ở `resolveWorkflows` (cần đọc `admin.workflows`). */
  agentWorkflows: SeedAgentWorkflow[];
  sideEffect: string[];
};
