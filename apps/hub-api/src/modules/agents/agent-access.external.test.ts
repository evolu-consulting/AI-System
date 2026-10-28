// CR-102a · com-c2-ext-deny · đối tác không bao giờ có agent (grant `tenant` cả công ty, agent mặc định/dự phòng) và không có
// Chat App (chat-gate). Thuần.
import { describe, expect, test } from "bun:test";
import { chatAppAllowed } from "../chat-gate/chat-gate.rules";
import type { ConfigSnapshot } from "../config/config.rules";
import { accessInput, visibleAgents } from "./agent-access.rules";
import { defaultRoute } from "./default-agent.rules";

const T = "t1";

describe("com-c2 · agent + Chat App", () => {
  const snap = {
    agents: [{ id: "a1", key: "helper", enabled: true, runtime: "agentic-cli", description: "" }],
    entitlements: [{ agentId: "a1", tenantId: T, revokedAt: null }],
    grants: [{ agentId: "a1", tenantId: T, subject: T }], // grant `tenant` = cả công ty
    orchestrator: null,
    tenantDefaults: new Map([
      [T, { defaultAgentId: "a1", onNoMatch: "answer", fallbackAgentId: "a1" }],
    ]),
  } as unknown as ConfigSnapshot;
  const who = { tenantId: T, userId: "u", groupIds: new Set<string>() };

  test("grant `tenant` + agent mặc định: nội bộ dùng được, đối tác không", () => {
    expect(visibleAgents(accessInput(snap, who)).map((a) => a.key)).toEqual(["helper"]);
    expect(defaultRoute(snap, who).kind).toBe("direct");
    const ext = { ...who, external: true };
    expect(visibleAgents(accessInput(snap, ext))).toEqual([]);
    expect(defaultRoute(snap, ext).kind).toBe("forbidden");
  });

  test("chatAppAllowed: đối tác luôn false (kể cả feature chưa tồn tại)", () => {
    const empty = { features: [], entitled: new Set<string>() };
    expect(chatAppAllowed(empty, { tenantId: T, role: "member" })).toBe(true);
    expect(chatAppAllowed(empty, { tenantId: T, role: "member", userKind: "external" })).toBe(
      false,
    );
  });
});
