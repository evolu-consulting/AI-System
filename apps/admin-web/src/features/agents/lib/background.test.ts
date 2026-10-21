// agents-background · helper thuần mục "Agent chạy nền của app".
import { describe, expect, it } from "bun:test";
import type { UsageAnalytics } from "@ai/contracts";
import type { AgentSettingsItem } from "@ai/contracts/hub-admin";
import { splitBySurface, studioAgentUrl, usageByAgent } from "./background";

const item = (key: string, surface: "chat" | "background") =>
  ({ agent: { id: `id-${key}`, key, name: { vi: key, en: key } }, surface }) as AgentSettingsItem;

describe("splitBySurface", () => {
  it("tách theo cờ surface, không theo key", () => {
    const r = splitBySurface([
      item("a", "chat"),
      item("price-scout", "background"),
      item("b", "chat"),
    ]);
    expect(r.chat.map((x) => x.agent.key)).toEqual(["a", "b"]);
    expect(r.background.map((x) => x.agent.key)).toEqual(["price-scout"]);
  });
  it("agent nền đang là mặc định công ty ở lại bảng chat", () => {
    const r = splitBySurface(
      [item("orch", "background"), item("price-scout", "background")],
      "id-orch",
    );
    expect(r.chat.map((x) => x.agent.key)).toEqual(["orch"]);
    expect(r.background.map((x) => x.agent.key)).toEqual(["price-scout"]);
  });
});

describe("usageByAgent", () => {
  it("cộng mọi dòng cây của cùng agent, bỏ dòng không có agent", () => {
    const tree = [
      { agent_id: "x", calls: 2, tokens: 10 },
      { agent_id: "x", calls: 1, tokens: 5 },
      { agent_id: null, calls: 9, tokens: 9 },
      { agent_id: "y", calls: 4, tokens: 40 },
    ] as unknown as UsageAnalytics["tree"];
    const m = usageByAgent(tree);
    expect(m.get("x")).toEqual({ calls: 3, tokens: 15 });
    expect(m.get("y")).toEqual({ calls: 4, tokens: 40 });
    expect(m.size).toBe(2);
  });
});

describe("studioAgentUrl", () => {
  it("ghép /agents/<id>; base rỗng ⇒ null", () => {
    expect(studioAgentUrl("https://studio.x/", "a b")).toBe("https://studio.x/agents/a%20b");
    expect(studioAgentUrl("", "a")).toBeNull();
    expect(studioAgentUrl(undefined, "a")).toBeNull();
  });
});
