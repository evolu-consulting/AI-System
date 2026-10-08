// HUB-FR-77 · HUB-FR-78 · CR-054 · helper màn Agents.
import { describe, expect, test } from "bun:test";
import type { AgentGrantRow, AgentSettingsItem } from "@ai/contracts/hub-admin";
import {
  defaultsForPick,
  defaultsFromChoice,
  fallbackCandidates,
  filterAgents,
  initials,
  modelText,
  noMatchChoice,
  runtimeKey,
  whoChips,
} from "./agents";

const id = (n: number) => `e4a0e000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const agent = (n: number, o: Partial<AgentSettingsItem> = {}): AgentSettingsItem => ({
  agent: { id: id(n), key: `a${n}`, name: { vi: `Agent ${n}`, en: `Agent ${n} EN` } },
  description: `mô tả ${n}`,
  runtime: "agentic-cli",
  model: { value: null, display_name: null },
  enabled: true,
  entitled: true,
  is_orchestrator: false,
  ...o,
});
const ORCH = agent(1, { is_orchestrator: true });
const A2 = agent(2);
const A3 = agent(3, { entitled: false });
const ITEMS = [ORCH, A2, A3];
const META = { granted_by: null, granted_at: "2026-10-08T00:00:00.000Z" };

describe("nhãn", () => {
  test("model: display_name → value → null (Mặc định CLI)", () => {
    expect(modelText({ value: "haiku", display_name: "Haiku" })).toBe("Haiku");
    expect(modelText({ value: "haiku", display_name: null })).toBe("haiku");
    expect(modelText({ value: null, display_name: null })).toBeNull();
  });
  test("runtime + chữ đầu avatar", () => {
    expect(runtimeKey("agentic-cli")).toBe("agents.runtime.cli");
    expect(runtimeKey("dify-agent")).toBe("agents.runtime.dify");
    expect(runtimeKey("python")).toBeNull();
    expect(initials("Evolu Consultant")).toBe("EC");
    expect(initials("Invoices")).toBe("IN");
  });
  test("tìm theo key/tên/mô tả", () => {
    expect(filterAgents(ITEMS, "A2", "vi").map((a) => a.agent.key)).toEqual(["a2"]);
    expect(filterAgents(ITEMS, "  ", "vi")).toHaveLength(3);
    expect(filterAgents(ITEMS, "3 en", "en").map((a) => a.agent.key)).toEqual(["a3"]);
  });
});

describe("agent mặc định", () => {
  test("agent thường ⇒ không dự phòng, answer", () => {
    expect(defaultsForPick(A2, null, ITEMS)).toEqual({
      default_agent_id: A2.agent.id,
      fallback_agent_id: null,
      on_no_match: "answer",
    });
  });
  test("Orchestrator giữ dự phòng cũ nếu còn hợp lệ, không thì Tự trả lời", () => {
    const cur = {
      default_agent_id: A2.agent.id,
      fallback_agent_id: A2.agent.id,
      on_no_match: "fallback" as const,
    };
    expect(defaultsForPick(ORCH, cur, ITEMS)).toEqual({
      default_agent_id: ORCH.agent.id,
      fallback_agent_id: A2.agent.id,
      on_no_match: "fallback",
    });
    const bad = { ...cur, fallback_agent_id: A3.agent.id };
    expect(defaultsForPick(ORCH, bad, ITEMS).on_no_match).toBe("answer");
    const ask = { ...cur, on_no_match: "ask" as const, fallback_agent_id: null };
    expect(defaultsForPick(ORCH, ask, ITEMS).on_no_match).toBe("ask");
  });
  test("ứng viên dự phòng: đã bật, không phải Orchestrator, ≠ mặc định", () => {
    expect(fallbackCandidates(ITEMS, ORCH.agent.id).map((a) => a.agent.key)).toEqual(["a2"]);
  });
  test("ô Không khớp agent nào ↔ body", () => {
    const d = {
      default_agent_id: ORCH.agent.id,
      fallback_agent_id: null,
      on_no_match: "answer" as const,
    };
    expect(noMatchChoice(d)).toBe("answer");
    const fb = defaultsFromChoice(d, A2.agent.id);
    expect(fb).toEqual({ ...d, fallback_agent_id: A2.agent.id, on_no_match: "fallback" });
    expect(noMatchChoice(fb)).toBe(A2.agent.id);
    expect(defaultsFromChoice(fb, "ask")).toEqual({ ...d, on_no_match: "ask" });
  });
});

describe("Ai được dùng", () => {
  const g: AgentGrantRow = {
    id: id(10),
    subject: {
      type: "group",
      group: {
        id: id(11),
        key: "ke-toan",
        name: { vi: "Kế toán", en: "Accounting" },
        is_beta: false,
      },
    },
    ...META,
  };
  const u: AgentGrantRow = {
    id: id(12),
    subject: { type: "user", user: { id: id(13), username: "vio.ngo", display_name: "Vio Ngo" } },
    ...META,
  };
  const all: AgentGrantRow = { id: id(14), subject: { type: "tenant" }, ...META };
  test("chưa bật / Orchestrator / cả công ty / nhóm + người / chưa cấp", () => {
    expect(whoChips(A3, [g])).toEqual([{ kind: "off" }]);
    expect(whoChips(ORCH, [])).toEqual([{ kind: "tenant" }]);
    expect(whoChips(A2, [g, all])).toEqual([{ kind: "tenant" }]);
    expect(whoChips(A2, [g, u]).map((c) => c.kind)).toEqual(["group", "user"]);
    expect(whoChips(A2, [])).toEqual([{ kind: "none" }]);
  });
});
