// ADM-FR-13, ADM-FR-15 · AC-A05 · dựng nhóm DependencyList (Command/Agent) từ `usages` hoặc `details` của WORKFLOW_IN_USE.
import type { AgentRef, UsageCommand } from "@ai/contracts";
import { agentTail, type DependencySection } from "@/components/shared/DependencyList";
import type { Translate } from "@/lib/format";

/** Agent chỉ có `id` ở Admin (Mơ hồ A6): hiện "Agent …{6 ký tự cuối}", không link. */
export function usageSections(
  t: Translate,
  commands: readonly UsageCommand[],
  agents: readonly AgentRef[],
): DependencySection[] {
  return [
    {
      title: t("common.dependency.command"),
      items: commands.map((c) => ({
        id: c.id,
        label: `/${c.name}`,
        mono: true,
        href: `/commands/${c.id}`,
        badge: c.enabled ? undefined : { tone: "off", text: t("common.off") },
      })),
    },
    {
      title: t("common.dependency.agent"),
      items: agents.map((a) => ({
        id: a.id,
        label: t("workflows.usage.agent", { id: agentTail(a.id) }),
      })),
    },
  ];
}

/** `{n} command · {m} agent` (bỏ nhóm bằng 0); rỗng khi cả hai bằng 0. */
export function usageSummary(t: Translate, commandCount: number, agentCount: number): string {
  const parts: string[] = [];
  if (commandCount > 0) parts.push(t("workflows.usage.commands", { count: commandCount }));
  if (agentCount > 0) parts.push(t("workflows.usage.agents", { count: agentCount }));
  return parts.join(" · ");
}
