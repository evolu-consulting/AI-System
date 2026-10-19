// Review HD3 m8 · agent trích theo phạm vi tenant: chỉ agent bật + entitlement còn hiệu lực của ĐÚNG tenant; agent chỉ cấp cho
// tenant khác / entitlement thu hồi / agent tắt ⇒ không bao giờ dùng.
import { describe, expect, test } from "bun:test";
import type { AgentConfig } from "../../config/config.rules";
import { extractAgentFor } from "./pack-runs-hd3";

const agent = (id: string, key: string, enabled = true) => ({ id, key, enabled }) as AgentConfig;
const ent = (agentId: string, tenantId: string, revokedAt: Date | null = null) => ({
  agentId,
  tenantId,
  revokedAt,
});

describe("extractAgentFor [m8]", () => {
  test("entitlement của tenant ⇒ dùng; chỉ tenant khác có ⇒ không", () => {
    const snap = {
      agents: [agent("a1", "contracts-extractor")],
      entitlements: [ent("a1", "acme")],
    };
    expect(extractAgentFor(snap, "contracts-extractor", "acme")?.id).toBe("a1");
    expect(extractAgentFor(snap, "contracts-extractor", "beta")).toBeUndefined();
  });
  test("entitlement thu hồi / agent tắt / khoá lạ ⇒ không", () => {
    const revoked = {
      agents: [agent("a1", "contracts-extractor")],
      entitlements: [ent("a1", "acme", new Date())],
    };
    expect(extractAgentFor(revoked, "contracts-extractor", "acme")).toBeUndefined();
    const off = {
      agents: [agent("a1", "contracts-extractor", false)],
      entitlements: [ent("a1", "acme")],
    };
    expect(extractAgentFor(off, "contracts-extractor", "acme")).toBeUndefined();
    expect(extractAgentFor(off, "khac", "acme")).toBeUndefined();
  });
});
