// dlc-engine · cài cổng Agent Hub cho gói `dlc` (kiểu theo cấu trúc `AgentHubPort` của gói — nền tảng không import nội bộ gói):
// chạy agent trong hội thoại của lượt (`AgentCallService`), sinh agent domain/QC (`SpawnService`), và tra ngữ cảnh job agent
// đang gọi tool `/mcp` (hội thoại + vai người dùng + quy trình DLC agent chỉ định — `runtime_options.dlc_flows`) cho `dlc-start`.
import { DlcFlowsSchema } from "@ai/contracts/studio";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import type { AgentCallService } from "./agent-call.service";
import type { SpawnService } from "./spawn.service";

type Who = { tenantId: string; userId: string; conversationId: string };
type Outcome = {
  status: "done" | "failed" | "timeout";
  text: string;
  dialog: { question: string; answer: string }[];
  error?: string;
};

type Deps = { db: Db; calls: AgentCallService; spawn: SpawnService };

async function roleOf(db: Db, tenantId: string, userId: string): Promise<AuthUser["role"]> {
  const [r] = await withHubScope(db, { kind: "system" }, (tx) =>
    tx.execute<{ role: AuthUser["role"] }>(sql`select role from admin.users
      where id = ${userId}::uuid and tenant_id = ${tenantId}::uuid`),
  );
  return r?.role ?? "member";
}

export function agentHubPort(d: Deps) {
  return {
    async call(w: Who, agentKey: string, prompt: string, signal?: AbortSignal): Promise<Outcome> {
      const role = await roleOf(d.db, w.tenantId, w.userId);
      const r = await d.calls.call({ ...w, role }, agentKey, prompt, signal);
      return {
        status: r.status,
        text: r.text,
        dialog: r.dialog,
        ...(r.error ? { error: `${r.error.code} ${r.error.message}`.slice(0, 300) } : {}),
      };
    },
    async spawn(
      w: Who,
      b: {
        project: string;
        template: string;
        agents: { domain: string; name: string; focus: string }[];
      },
    ): Promise<string[]> {
      const r = await d.spawn.spawn({ tenantId: w.tenantId, userId: w.userId }, b);
      return r.agents.map((a) => a.key);
    },
    async jobContext(tenantId: string, hubRunId: string) {
      const [r] = await withHubScope(d.db, { kind: "system" }, (tx) =>
        tx.execute<{
          conversation_id: string | null;
          user_id: string;
          role: string;
          dlc_flows: unknown;
        }>(sql`select r.conversation_id, r.user_id, u.role, a.runtime_options->'dlc_flows' as dlc_flows
          from hub.runs r join admin.users u on u.id = r.user_id and u.tenant_id = r.tenant_id
          left join hub.agents a on a.id = r.agent_id
          where r.id = ${hubRunId}::uuid and r.tenant_id = ${tenantId}::uuid`),
      );
      if (!r) return null;
      // Ghi đã kiểm ở Studio; dữ liệu lệch (seed tay) ⇒ bỏ qua, lượt theo quy trình của tenant.
      const flows = DlcFlowsSchema.safeParse(r.dlc_flows ?? {});
      return {
        conversationId: r.conversation_id,
        userId: r.user_id,
        role: r.role,
        agentFlows: flows.success ? flows.data : {},
      };
    },
  };
}
