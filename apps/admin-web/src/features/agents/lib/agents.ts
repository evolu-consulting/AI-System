// HUB-FR-77 · HUB-FR-78 · CR-054 · helper thuần màn Agents: nhãn model/runtime, agent mặc định + dự phòng, "Ai được dùng".
import type {
  AgentDefaults,
  AgentGrantRow,
  AgentSettingsItem,
  GroupRef,
  OnNoMatch,
} from "@ai/contracts/hub-admin";

/** Agent dùng được ở công ty: bật toàn hệ thống ∧ bật cho công ty. */
export const isActive = (a: Pick<AgentSettingsItem, "enabled" | "entitled">): boolean =>
  a.enabled && a.entitled;

/** Model hiển thị: tên danh mục → giá trị → `null` (= "Mặc định CLI"). */
export function modelText(m: AgentSettingsItem["model"]): string | null {
  return m.display_name ?? m.value ?? null;
}

/** runtime → khoá i18n "Chạy bằng" (`agents.runtime.*`); runtime lạ → `null` (hiện nguyên chữ). */
export function runtimeKey(runtime: string): "agents.runtime.cli" | "agents.runtime.dify" | null {
  if (runtime === "agentic-cli") return "agents.runtime.cli";
  if (runtime.startsWith("dify")) return "agents.runtime.dify";
  return null;
}

/** "Evolu Consultant" → "EC"; một từ → 2 chữ đầu. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const raw = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "?");
  return raw.slice(0, 2).toUpperCase();
}

/** Agent dự phòng hợp lệ khi Orchestrator mặc định: đang dùng được, không phải Orchestrator, ≠ mặc định. */
export function fallbackCandidates(items: readonly AgentSettingsItem[], defaultId: string) {
  return items.filter((a) => isActive(a) && !a.is_orchestrator && a.agent.id !== defaultId);
}

/**
 * Body PUT khi bấm "Đặt mặc định" cho `pick`. Agent thường ⇒ không dự phòng (`answer`, như Hub chuẩn hoá).
 * Orchestrator ⇒ giữ dự phòng cũ nếu còn hợp lệ, không thì "Tự trả lời".
 */
export function defaultsForPick(
  pick: AgentSettingsItem,
  current: AgentDefaults | null,
  items: readonly AgentSettingsItem[],
): AgentDefaults {
  const id = pick.agent.id;
  const plain: AgentDefaults = {
    default_agent_id: id,
    fallback_agent_id: null,
    on_no_match: "answer",
  };
  if (!pick.is_orchestrator || !current) return plain;
  if (current.on_no_match === "ask") return { ...plain, on_no_match: "ask" };
  const fb = current.fallback_agent_id;
  const ok = fb !== null && fallbackCandidates(items, id).some((a) => a.agent.id === fb);
  return ok ? { default_agent_id: id, fallback_agent_id: fb, on_no_match: "fallback" } : plain;
}

/** Giá trị ô "Không khớp agent nào →": id agent dự phòng | `answer` | `ask`. */
export type NoMatchChoice = string;

export function noMatchChoice(d: AgentDefaults): NoMatchChoice {
  return d.on_no_match === "fallback" && d.fallback_agent_id ? d.fallback_agent_id : d.on_no_match;
}

const MODES: readonly OnNoMatch[] = ["answer", "ask"];

export function defaultsFromChoice(d: AgentDefaults, choice: NoMatchChoice): AgentDefaults {
  const mode = MODES.find((m) => m === choice);
  if (mode)
    return { default_agent_id: d.default_agent_id, fallback_agent_id: null, on_no_match: mode };
  return {
    default_agent_id: d.default_agent_id,
    fallback_agent_id: choice,
    on_no_match: "fallback",
  };
}

/** Chip "Ai được dùng" (nhãn đã dịch ở component theo `kind`). */
export type WhoChip =
  | { kind: "tenant" }
  | { kind: "group"; id: string; name: GroupRef["name"] }
  | { kind: "user"; id: string; name: string }
  | { kind: "none" }
  | { kind: "off" };

export function whoChips(item: AgentSettingsItem, rows: readonly AgentGrantRow[]): WhoChip[] {
  if (!isActive(item)) return [{ kind: "off" }];
  if (item.is_orchestrator) return [{ kind: "tenant" }];
  if (rows.some((r) => r.subject.type === "tenant")) return [{ kind: "tenant" }];
  const chips: WhoChip[] = [];
  for (const r of rows) {
    const s = r.subject;
    if (s.type === "group") chips.push({ kind: "group", id: s.group.id, name: s.group.name });
    else if (s.type === "user")
      chips.push({ kind: "user", id: s.user.id, name: s.user.display_name });
  }
  return chips.length > 0 ? chips : [{ kind: "none" }];
}

/** Ô "Tìm agent": khớp key, tên (theo ngôn ngữ), mô tả — không phân biệt hoa thường. */
export function filterAgents(
  items: readonly AgentSettingsItem[],
  q: string,
  lang: string,
): AgentSettingsItem[] {
  const needle = q.trim().toLowerCase();
  if (needle === "") return [...items];
  return items.filter((a) => {
    const name = lang.startsWith("en") ? a.agent.name.en : a.agent.name.vi;
    return [a.agent.key, name, a.description].some((s) => s.toLowerCase().includes(needle));
  });
}
