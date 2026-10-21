// agents-background · helper thuần của mục "Agent chạy nền của app" (màn Agents): tách theo cờ `surface` của Hub (dữ liệu, không
// khoá cứng key), gộp usage tháng theo agent, dựng link Studio. Không đọc i18n/DOM — test được.
import type { UsageAnalytics } from "@ai/contracts";
import type { AgentSettingsItem } from "@ai/contracts/hub-admin";

export const isBackground = (a: Pick<AgentSettingsItem, "surface">): boolean =>
  a.surface === "background";

/**
 * Agent chat (cấp quyền được) và agent chạy nền; giữ thứ tự Hub. Agent nền đang là mặc định của công ty (vd Orchestrator được đặt
 * làm mặc định từ trước) ở lại bảng trên để còn ô "Không khớp agent nào →".
 */
export function splitBySurface(
  items: readonly AgentSettingsItem[],
  defaultAgentId: string | null = null,
): {
  chat: AgentSettingsItem[];
  background: AgentSettingsItem[];
} {
  const bg = (a: AgentSettingsItem) => isBackground(a) && a.agent.id !== defaultAgentId;
  return { chat: items.filter((a) => !bg(a)), background: items.filter(bg) };
}

export type AgentUsage = { calls: number; tokens: number };

/** agent_id → lượt gọi + token từ cây usage (cộng mọi app/tính năng/model của agent). */
export function usageByAgent(tree: UsageAnalytics["tree"]): ReadonlyMap<string, AgentUsage> {
  const m = new Map<string, AgentUsage>();
  for (const r of tree) {
    if (r.agent_id === null) continue;
    const cur = m.get(r.agent_id) ?? { calls: 0, tokens: 0 };
    m.set(r.agent_id, { calls: cur.calls + r.calls, tokens: cur.tokens + r.tokens });
  }
  return m;
}

/** Link "Mở trong Studio" tới trang agent; base rỗng ⇒ null (không hiện nút). */
export function studioAgentUrl(base: string | undefined, agentId: string): string | null {
  const b = (base ?? "").trim().replace(/\/+$/, "");
  return b === "" ? null : `${b}/agents/${encodeURIComponent(agentId)}`;
}
