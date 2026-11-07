// arch-a7 · shared/agent-stage.rules.ts phai khop registry node (runsAsAgent/agentIdOf) cho moi loai executor.
import { describe, expect, test } from "bun:test";
import {
  agentIdOf as sharedAgentIdOf,
  runsAsAgent as sharedRunsAsAgent,
} from "../../../shared/agent-stage.rules";
import { agentIdOf, NODES, runsAsAgent } from "./registry";

describe("shared/agent-stage.rules khop registry", () => {
  for (const kind of Object.keys(NODES)) {
    test(`kind ${kind}`, () => {
      expect(sharedRunsAsAgent(kind)).toBe(runsAsAgent(kind));
      const ex = { kind, agent_id: "a1" };
      expect(sharedAgentIdOf(ex)).toBe(agentIdOf(ex));
      expect(sharedAgentIdOf({ kind, agent_id: 5 } as never)).toBe(
        agentIdOf({ kind, agent_id: 5 } as never),
      );
    });
  }
  test("kind la", () => {
    expect(sharedRunsAsAgent("zzz")).toBe(runsAsAgent("zzz"));
    expect(sharedAgentIdOf({ kind: "zzz" })).toBe(agentIdOf({ kind: "zzz" }));
  });
});
