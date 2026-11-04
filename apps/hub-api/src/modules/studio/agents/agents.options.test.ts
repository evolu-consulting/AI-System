// dlc-agent-flows · lỗi prod: Lưu dlc-agent trong Agent Forge làm mất `runtime_options.pack_tools` ⇒ PUT không có khoá giữ bản đang lưu.
import { describe, expect, it } from "bun:test";
import { keepCliExtras } from "./agents.options";

const stored = {
  cli: "claude",
  mcp: true,
  cwd_mode: "job",
  max_turns: 30,
  allowed_tools: ["Read"],
  pack_tools: ["dlc-start", "dlc-runs"],
};
/** Body form cũ: chỉ các trường form biết. */
const oldForm = {
  cli: "claude",
  allowed_tools: ["Read"],
  mcp: true,
  cwd_mode: "job",
  max_turns: 30,
};

describe("dlc-agent-flows · keepCliExtras", () => {
  it("tái hiện lỗi: form cũ không gửi pack_tools ⇒ giữ pack_tools đang lưu", () => {
    expect(keepCliExtras("agentic-cli", oldForm, stored)).toEqual(stored);
  });
  it("gửi pack_tools [] / dlc_flows {} ⇒ là xoá thật, không giữ bản cũ", () => {
    const r = keepCliExtras(
      "agentic-cli",
      { ...oldForm, pack_tools: [], dlc_flows: {} },
      {
        ...stored,
        dlc_flows: { "bug-fix": "x" },
      },
    );
    expect(r?.pack_tools).toEqual([]);
    expect(r?.dlc_flows).toEqual({});
  });
  it("giữ cả dlc_flows + persona_project; runtime khác / không body ⇒ y nguyên", () => {
    const cur = { ...stored, dlc_flows: { enhancement: "e" }, persona_project: "agent-dlc" };
    expect(keepCliExtras("agentic-cli", oldForm, cur)).toEqual(cur);
    expect(keepCliExtras("llm", {}, stored)).toEqual({});
    expect(keepCliExtras("agentic-cli", undefined, stored)).toBeUndefined();
  });
});
