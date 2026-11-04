// dlc-agent-flows · `runtime_options.dlc_flows` + `pack_tools` của agent agentic-cli (unit contract).
import { describe, expect, it } from "bun:test";
import { agentUpdateSchemaFor, DLC_FLOW_MODES, DlcFlowsSchema, dlcFlowSlotOf } from "./index";

const P = "e4a00000-0000-4000-8000-000000000311";
const base = {
  name: { vi: "a", en: "b" },
  description: "m".repeat(20),
  profile_id: P,
  version: 1,
};
const cli = agentUpdateSchemaFor("agentic-cli");

describe("dlc-agent-flows · contract", () => {
  it("dlc_flows: khoá = dây chuyền, giá trị = key def; khoá lạ / key sai ✗", () => {
    expect(DlcFlowsSchema.safeParse({}).success).toBe(true);
    expect(DlcFlowsSchema.safeParse({ "bug-fix": "dlc-bug-fix-md" }).success).toBe(true);
    expect(DlcFlowsSchema.safeParse({ hotfix: "x" }).success).toBe(false);
    expect(DlcFlowsSchema.safeParse({ enhancement: "Bad Key" }).success).toBe(false);
    expect(DlcFlowsSchema.safeParse({ enhancement: "" }).success).toBe(false);
    expect(DlcFlowsSchema.safeParse({ enhancement: `a${"b".repeat(64)}` }).success).toBe(false);
  });
  it("agentic-cli giữ pack_tools + dlc_flows qua parse (round trip)", () => {
    const opts = {
      cli: "claude",
      allowed_tools: ["Read"],
      mcp: true,
      cwd_mode: "job",
      max_turns: 30,
      pack_tools: ["dlc-start", "dlc-runs"],
      dlc_flows: { "new-system": "dlc-new-system-md" },
    };
    const r = cli.parse({ ...base, runtime_options: opts });
    expect(r).toMatchObject({ runtime_options: opts });
  });
  it("agentic-cli: dlc_flows sai ⇒ ✗ ở runtime_options.dlc_flows", () => {
    const r = cli.safeParse({ ...base, runtime_options: { dlc_flows: { x: "y" } } });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path.slice(0, 2)).toEqual(["runtime_options", "dlc_flows"]);
  });
  it("khe của dây chuyền = dlc.<mode>", () => {
    expect(DLC_FLOW_MODES.map(dlcFlowSlotOf)).toEqual([
      "dlc.new-system",
      "dlc.enhancement",
      "dlc.bug-fix",
    ]);
  });
});
